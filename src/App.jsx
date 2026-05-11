import { useState } from 'react'
import './App.css'

const searchTypes = [
  'gas_station',
  'restaurant',
  'shopping_mall',
  'department_store',
  'supermarket',
  'convenience_store',
]

const restStopSearchTerms = ['rest area', 'rest stop', 'travel plaza', 'service plaza']
const allowedPrimaryTypes = new Set(searchTypes)

const typeLabels = {
  convenience_store: 'Convenience store',
  department_store: 'Retail',
  gas_station: 'Gas station',
  restaurant: 'Restaurant',
  shopping_mall: 'Mall',
  supermarket: 'Grocery store',
}

const demoBathrooms = [
  {
    id: 'demo-shell',
    name: 'Shell Gas Station',
    type: 'Gas station',
    distance: 0.3,
  },
  {
    id: 'demo-mcdonalds',
    name: "McDonald's",
    type: 'Fast food',
    distance: 0.5,
  },
  {
    id: 'demo-rest-area',
    name: 'Rest Area',
    type: 'Rest stop',
    distance: 1.4,
  },
  {
    id: 'demo-target',
    name: 'Target',
    type: 'Retail',
    distance: 1.7,
  },
]

const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
let googleMapsPromise

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function loadGoogleMaps() {
  if (!googleMapsApiKey) {
    const error = new Error('Missing Google Maps API key')
    console.error('Google Places error: missing API key', error)
    return Promise.reject(error)
  }

  if (window.google?.maps?.importLibrary) {
    return Promise.resolve(window.google)
  }

  if (!googleMapsPromise) {
    googleMapsPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      const params = new URLSearchParams({
        key: googleMapsApiKey,
        v: 'weekly',
        libraries: 'places',
      })

      script.src = `https://maps.googleapis.com/maps/api/js?${params}`
      script.async = true
      script.onerror = () => {
        const error = new Error('Could not load Google Maps JS')
        console.error('Google Places error: Google Maps JS failed to load', error)
        reject(error)
      }
      script.onload = () => resolve(window.google)
      document.head.append(script)
    })
  }

  return googleMapsPromise
}

function getLatLng(location) {
  return {
    lat: typeof location.lat === 'function' ? location.lat() : location.lat,
    lng: typeof location.lng === 'function' ? location.lng() : location.lng,
  }
}

function hasUsableLocation(destination) {
  return Number.isFinite(destination.lat) && Number.isFinite(destination.lng)
}

function getDistanceMiles(start, end) {
  const milesPerKm = 0.621371
  const earthRadiusKm = 6371
  const latDelta = ((end.lat - start.latitude) * Math.PI) / 180
  const lngDelta = ((end.lng - start.longitude) * Math.PI) / 180
  const startLat = (start.latitude * Math.PI) / 180
  const endLat = (end.lat * Math.PI) / 180
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(lngDelta / 2) ** 2
  const distanceKm = earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return distanceKm * milesPerKm
}

function isRestStopResult(place) {
  const name = (place.displayName || '').toLowerCase()

  return restStopSearchTerms.some((term) => name.includes(term))
}

function normalizePlaceName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/(gasstation|restaurant|store|supermarket|travelcenter)$/g, '')
}

function getTypeLabel(place, searchType) {
  const name = (place.displayName || '').toLowerCase()

  if (searchType === 'rest_stop') {
    return name.includes('travel plaza') || name.includes('service plaza')
      ? 'Travel plaza'
      : 'Rest stop'
  }

  if (
    searchType === 'restaurant' &&
    /mcdonald|burger king|wendy|taco bell|subway|chick-fil-a|kfc|popeyes|sonic|arbys/.test(
      name,
    )
  ) {
    return 'Fast food'
  }

  return typeLabels[place.primaryType] || typeLabels[searchType] || 'Restaurant'
}

async function searchNearbyBathrooms(location) {
  await loadGoogleMaps()

  let placesLibrary

  try {
    placesLibrary = await window.google.maps.importLibrary('places')
  } catch (error) {
    console.error('Google Places error: importLibrary("places") failed', error)
    throw error
  }

  const { Place } = placesLibrary
  const center = {
    lat: location.latitude,
    lng: location.longitude,
  }
  const nearbySearches = searchTypes.map(async (type) => {
    try {
      const { places } = await Place.searchNearby({
        fields: ['displayName', 'location', 'primaryType'],
        includedPrimaryTypes: [type],
        locationRestriction: {
          center,
          radius: 5000,
        },
      })

      return places.map((place) => ({ place, searchType: type }))
    } catch (error) {
      console.error(`Google Places error: Place.searchNearby failed for ${type}`, error)
      throw error
    }
  })
  const restStopSearches = restStopSearchTerms.map(async (term) => {
    try {
      const { places } = await Place.searchByText({
        textQuery: term,
        fields: ['displayName', 'location', 'primaryType'],
        locationBias: center,
        maxResultCount: 8,
      })

      return places.map((place) => ({ place, searchType: 'rest_stop' }))
    } catch (error) {
      console.error(`Google Places error: Place.searchByText failed for ${term}`, error)
      throw error
    }
  })

  const settled = await Promise.allSettled([...nearbySearches, ...restStopSearches])
  const successful = settled
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value)

  if (successful.length === 0) {
    const error = new Error('No places found')
    console.error('Google Places error: no places found', {
      error,
      failedSearches: settled.filter((result) => result.status === 'rejected'),
    })
    throw error
  }

  const byId = new Map()

  for (const { place, searchType } of successful) {
    if (!place.location) continue
    if (searchType === 'rest_stop' && !isRestStopResult(place)) continue
    if (searchType !== 'rest_stop' && !allowedPrimaryTypes.has(place.primaryType)) continue

    const destination = getLatLng(place.location)
    if (!hasUsableLocation(destination)) continue

    const distance = getDistanceMiles(location, destination)
    const placeName = place.displayName || 'Nearby place'
    const id = `${normalizePlaceName(placeName)}-${destination.lat.toFixed(
      4,
    )}-${destination.lng.toFixed(4)}`
    const result = {
      id,
      name: placeName,
      type: getTypeLabel(place, searchType),
      distance,
      destination,
    }
    const existing = byId.get(id)

    if (!existing || result.distance < existing.distance) {
      byId.set(id, result)
    }
  }

  const results = [...byId.values()]
    .sort((first, second) => first.distance - second.distance)
    .slice(0, 8)

  if (results.length === 0) {
    const error = new Error('No places found')
    console.error('Google Places error: no places found', error)
    throw error
  }

  return results
}

function formatDistance(distance) {
  if (distance < 0.1) return '<0.1 mi'

  return `${distance.toFixed(1)} mi`
}

function openDirections(destination) {
  if (!destination) return

  const url = `https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}`
  window.open(url, '_blank', 'noopener,noreferrer')
}

function App() {
  const [view, setView] = useState('panic')
  const [isLoading, setIsLoading] = useState(false)
  const [location, setLocation] = useState(null)
  const [bathrooms, setBathrooms] = useState([])
  const [usingDemoResults, setUsingDemoResults] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [googleErrorMessage, setGoogleErrorMessage] = useState('')

  function handlePanic() {
    if (isLoading) return

    if (!navigator.geolocation) {
      setUsingDemoResults(false)
      setErrorMessage('Location needed to find nearby bathrooms.')
      setGoogleErrorMessage('')
      setView('location-error')
      return
    }

    setErrorMessage('')
    setGoogleErrorMessage('')
    setIsLoading(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const nextLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }

        try {
          const results = await searchNearbyBathrooms(nextLocation)

          setLocation(nextLocation)
          setBathrooms(results)
          setUsingDemoResults(false)
          setGoogleErrorMessage('')
          setView('results')
        } catch (error) {
          setLocation(nextLocation)
          setBathrooms(demoBathrooms)
          setUsingDemoResults(true)
          setGoogleErrorMessage(getErrorMessage(error))
          setView('results')
        } finally {
          setIsLoading(false)
        }
      },
      () => {
        setLocation(null)
        setBathrooms([])
        setUsingDemoResults(false)
        setErrorMessage('Location needed to find nearby bathrooms.')
        setGoogleErrorMessage('')
        setIsLoading(false)
        setView('location-error')
      },
    )
  }

  function handleBack() {
    setIsLoading(false)
    setView('panic')
  }

  if (view === 'results') {
    return (
      <main className="results-screen" aria-label="Closest likely bathrooms">
        <button className="back-button" type="button" onClick={handleBack}>
          Back
        </button>
        {location && <p className="location-status">Location found</p>}
        {usingDemoResults && <p className="location-status">Demo results shown</p>}
        {googleErrorMessage && (
          <p className="google-error">Google error: {googleErrorMessage}</p>
        )}

        <section className="results-list">
          {bathrooms.map((bathroom) => (
            <article className="bathroom-result" key={bathroom.id}>
              <div>
                <h2>{bathroom.name}</h2>
                <p>{bathroom.type}</p>
              </div>
              <div className="result-actions">
                <span>{formatDistance(bathroom.distance)}</span>
                <button
                  type="button"
                  disabled={!bathroom.destination}
                  onClick={() => openDirections(bathroom.destination)}
                >
                  Directions
                </button>
              </div>
            </article>
          ))}
        </section>

        <aside className="ad-placeholder" aria-label="Sponsored">
          <span>Sponsored</span>
          <p>AdMob banner</p>
        </aside>
      </main>
    )
  }

  if (view === 'location-error') {
    return (
      <main className="results-screen" aria-label="Location error">
        <button className="back-button" type="button" onClick={handleBack}>
          Back
        </button>

        <section className="error-panel">
          <p>{errorMessage}</p>
          {googleErrorMessage && (
            <p className="google-error">Google error: {googleErrorMessage}</p>
          )}
          <button type="button" onClick={handlePanic}>
            Try Again
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="panic-screen">
      <button
        className="panic-button"
        type="button"
        aria-label="Find nearby bathrooms"
        aria-busy={isLoading}
        onClick={handlePanic}
      >
        {isLoading && <span className="spinner" aria-hidden="true" />}
      </button>
    </main>
  )
}

export default App
