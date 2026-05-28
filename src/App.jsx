import { useEffect, useState } from 'react'
import { AdMob, BannerAdPosition, BannerAdSize } from '@capacitor-community/admob'
import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
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
const androidProductionBannerAdId = 'ca-app-pub-4684203752769089/7399655042'
const androidTestBannerAdId = 'ca-app-pub-3940256099942544/6300978111'
const useTestBannerAds =
  import.meta.env.DEV || import.meta.env.VITE_ADMOB_TEST_ADS === 'true'
const androidBannerAdId = useTestBannerAds
  ? androidTestBannerAdId
  : androidProductionBannerAdId
const androidBannerBottomMargin = 8
let adMobInitializePromise

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
  const name = getPlaceDisplayName(place).toLowerCase()

  return restStopSearchTerms.some((term) => name.includes(term))
}

const proximityThresholdMiles = 0.047

function normalizePlaceName(name) {
  if (!name) return ''

  return name
    .toLowerCase()
    .replace(/['`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(
      /\b(gas station|convenience store|travel center|travel plaza|service plaza|restaurant|store|supermarket|shopping mall|mall|fast food)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizePlaceId(value) {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null

  return trimmed.replace(/^places\//i, '').toLowerCase()
}

function getPlaceId(place) {
  return normalizePlaceId(place.id)
}

function getPlaceDisplayName(place) {
  if (typeof place.displayName === 'string' && place.displayName.trim()) {
    return place.displayName.trim()
  }

  if (
    place.displayName &&
    typeof place.displayName === 'object' &&
    typeof place.displayName.text === 'string' &&
    place.displayName.text.trim()
  ) {
    return place.displayName.text.trim()
  }

  if (typeof place.name === 'string' && place.name.trim()) {
    const fallbackName = place.name.trim()

    return /^places\//i.test(fallbackName) ? 'Nearby place' : fallbackName
  }

  return 'Nearby place'
}

function getOpeningStatus(place) {
  const statusSources = [
    place.currentOpeningHours,
    place.regularOpeningHours,
    place,
  ]

  for (const source of statusSources) {
    if (source && typeof source === 'object') {
      const openNow =
        typeof source.openNow === 'boolean'
          ? source.openNow
          : typeof source.open_now === 'boolean'
          ? source.open_now
          : undefined

      if (typeof openNow === 'boolean') {
        return { isOpenNow: openNow, hasKnownOpenStatus: true }
      }
    }
  }

  return { isOpenNow: undefined, hasKnownOpenStatus: false }
}

function getBusinessStatus(place) {
  if (place.businessStatus == null) return ''

  return String(place.businessStatus).trim().toUpperCase()
}

function isExplicitlyClosedBusinessStatus(status) {
  return status === 'CLOSED_PERMANENTLY' || status === 'CLOSED_TEMPORARILY'
}

function getCategoryRank(typeLabel) {
  const rankMap = {
    'Rest stop': 0,
    'Travel plaza': 0,
    'Gas station': 1,
    'Convenience store': 2,
    'Grocery store': 3,
    Retail: 4,
    Mall: 5,
    'Fast food': 6,
    Restaurant: 7,
  }

  return rankMap[typeLabel] ?? 10
}

function getAvailabilityRank(result) {
  if (result.isOpenNow) return 0
  if (result.isDefinitelyClosedNow) return 3
  if (result.isOperational) return 1

  return 2
}

function getNameCleanlinessScore(result) {
  const name = result.name || ''
  const normalizedName = result.normalizedName || normalizePlaceName(name)
  const noisySuffixPattern =
    /\b(gas station|convenience store|travel center|travel plaza|service plaza|restaurant|store|supermarket|shopping mall|mall|fast food)\b/i

  return (
    name.length +
    (/[|]/.test(name) ? 30 : 0) +
    (noisySuffixPattern.test(name) ? 20 : 0) +
    Math.max(0, normalizedName.length - 24)
  )
}

function chooseCleanerName(existing, candidate) {
  const existingScore = getNameCleanlinessScore(existing)
  const candidateScore = getNameCleanlinessScore(candidate)

  if (existingScore !== candidateScore) {
    return candidateScore < existingScore ? candidate : existing
  }

  return candidate.name.length < existing.name.length ? candidate : existing
}

function chooseBetterPlace(existing, candidate) {
  const distanceDelta = candidate.distance - existing.distance

  if (Math.abs(distanceDelta) > 0.001) {
    return candidate.distance < existing.distance ? candidate : existing
  }

  const existingAvailabilityRank = getAvailabilityRank(existing)
  const candidateAvailabilityRank = getAvailabilityRank(candidate)

  if (existingAvailabilityRank !== candidateAvailabilityRank) {
    return candidateAvailabilityRank < existingAvailabilityRank ? candidate : existing
  }

  const existingRank = getCategoryRank(existing.type)
  const candidateRank = getCategoryRank(candidate.type)

  if (existingRank !== candidateRank) {
    return candidateRank < existingRank ? candidate : existing
  }

  return chooseCleanerName(existing, candidate)
}

function mergeDuplicatePlaces(existing, candidate) {
  const base = chooseBetterPlace(existing, candidate)
  const cleanerName = chooseCleanerName(existing, candidate)
  const strongerType =
    getCategoryRank(candidate.type) < getCategoryRank(existing.type)
      ? candidate.type
      : existing.type
  const placeIds = Array.from(
    new Set([...(existing.placeIds || []), ...(candidate.placeIds || [])]),
  )
  const placeId = placeIds[0] || null
  const merged = {
    ...base,
    id: placeId || base.id,
    placeId,
    placeIds,
    name: cleanerName.name,
    normalizedName: cleanerName.normalizedName,
    type: strongerType,
  }

  return merged
}

function areSimilarNames(firstName, secondName) {
  if (!firstName || !secondName) return false
  if (firstName === secondName) return true

  const [shorter, longer] =
    firstName.length <= secondName.length
      ? [firstName, secondName]
      : [secondName, firstName]

  return shorter.length >= 3 && longer.startsWith(`${shorter} `)
}

function areSamePlace(existing, candidate) {
  if (!existing.destination || !candidate.destination) return false
  if (!areSimilarNames(existing.normalizedName, candidate.normalizedName)) return false

  const distanceBetween = getDistanceMiles(
    { latitude: existing.destination.lat, longitude: existing.destination.lng },
    candidate.destination,
  )

  return distanceBetween < proximityThresholdMiles
}

function getTypeLabel(place, searchType) {
  const name = getPlaceDisplayName(place).toLowerCase()

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
  const fields = [
    'id',
    'displayName',
    'location',
    'primaryType',
    'types',
    'businessStatus',
    'currentOpeningHours',
    'regularOpeningHours',
  ]

  const nearbySearches = searchTypes.map(async (type) => {
    try {
      const { places } = await Place.searchNearby({
        fields,
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
        fields,
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

  const stats = {
    totalReturnedByGoogle: successful.length,
    removedPermanentlyOrTemporarilyClosed: 0,
    remainedAfterFiltering: 0,
    remainedAfterDeduping: 0,
  }
  const failedSearches = settled.filter((result) => result.status === 'rejected')

  if (successful.length === 0) {
    console.info('Google Places result filtering', stats)

    if (failedSearches.length > 0) {
      const error =
        failedSearches[0].reason instanceof Error
          ? failedSearches[0].reason
          : new Error('Google Places search failed')

      console.error('Google Places error: all searches failed', {
        error,
        failedSearches,
      })
      throw error
    }

    const error = new Error('No places found')
    console.error('Google Places error: no places found', {
      error,
      failedSearches,
    })
    throw error
  }

  const candidates = []

  for (const { place, searchType } of successful) {
    if (!place.location) continue
    if (searchType === 'rest_stop' && !isRestStopResult(place)) continue
    if (
      searchType !== 'rest_stop' &&
      place.primaryType &&
      !allowedPrimaryTypes.has(place.primaryType)
    ) {
      continue
    }

    const businessStatus = getBusinessStatus(place)
    if (isExplicitlyClosedBusinessStatus(businessStatus)) {
      stats.removedPermanentlyOrTemporarilyClosed += 1
      continue
    }

    const openingStatus = getOpeningStatus(place)

    const destination = getLatLng(place.location)
    if (!hasUsableLocation(destination)) continue

    const distance = getDistanceMiles(location, destination)
    const placeName = getPlaceDisplayName(place)
    const placeId = getPlaceId(place)
    const normalizedName = normalizePlaceName(placeName)
    const candidate = {
      id:
        placeId ||
        `${normalizedName}-${destination.lat.toFixed(4)}-${destination.lng.toFixed(4)}`,
      placeId,
      placeIds: placeId ? [placeId] : [],
      name: placeName,
      normalizedName,
      type: getTypeLabel(place, searchType),
      distance,
      destination,
      isOperational: businessStatus === 'OPERATIONAL',
      isOpenNow: openingStatus.isOpenNow === true,
      isDefinitelyClosedNow:
        openingStatus.hasKnownOpenStatus && openingStatus.isOpenNow === false,
      hasKnownOpenStatus: openingStatus.hasKnownOpenStatus,
    }

    candidates.push(candidate)
  }

  stats.remainedAfterFiltering = candidates.length

  const deduped = []
  const seenById = new Map()

  for (const candidate of candidates) {
    const existingById = candidate.placeId ? seenById.get(candidate.placeId) : null
    let existing = existingById || deduped.find((result) => areSamePlace(result, candidate))

    if (existing) {
      const merged = mergeDuplicatePlaces(existing, candidate)
      const index = deduped.indexOf(existing)

      if (index >= 0) {
        deduped[index] = merged
      }

      for (const id of merged.placeIds) {
        seenById.set(id, merged)
      }
    } else {
      deduped.push(candidate)

      for (const id of candidate.placeIds) {
        seenById.set(id, candidate)
      }
    }
  }

  const nonClosedNowResults = deduped.filter((result) => !result.isDefinitelyClosedNow)
  const sortableResults = nonClosedNowResults.length >= 8 ? nonClosedNowResults : deduped

  stats.remainedAfterDeduping = deduped.length
  console.info('Google Places result filtering', stats)

  const results = sortableResults
    .sort((first, second) => {
      const availabilityDelta = getAvailabilityRank(first) - getAvailabilityRank(second)

      if (availabilityDelta !== 0) {
        return availabilityDelta
      }

      return first.distance - second.distance
    })
    .slice(0, 8)

  if (results.length === 0) {
    const error = new Error('No places found')
    console.error('Google Places error: no places found', {
      error,
      stats,
    })
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

function getBrowserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Browser geolocation is unavailable'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
      },
      reject,
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    )
  })
}

async function getCurrentLocation() {
  if (Capacitor.isNativePlatform()) {
    const permission = await Geolocation.requestPermissions()

    if (permission.location === 'denied' && permission.coarseLocation === 'denied') {
      throw new Error('Location permission denied')
    }

    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    })

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    }
  }

  return getBrowserLocation()
}

function initializeAdMob() {
  if (!adMobInitializePromise) {
    adMobInitializePromise = AdMob.initialize()
  }

  return adMobInitializePromise
}

function App() {
  const [view, setView] = useState('panic')
  const [isLoading, setIsLoading] = useState(false)
  const [location, setLocation] = useState(null)
  const [bathrooms, setBathrooms] = useState([])
  const [usingDemoResults, setUsingDemoResults] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [googleErrorMessage, setGoogleErrorMessage] = useState('')
  const [showAdFallback, setShowAdFallback] = useState(!Capacitor.isNativePlatform())

  useEffect(() => {
    let isActive = true

    async function syncBanner() {
      if (!Capacitor.isNativePlatform()) {
        setShowAdFallback(view === 'results')
        return
      }

      try {
        if (view === 'results') {
          setShowAdFallback(false)
          await initializeAdMob()

          if (!isActive) return

          await AdMob.showBanner({
            adId: androidBannerAdId,
            adSize: BannerAdSize.ADAPTIVE_BANNER,
            position: BannerAdPosition.BOTTOM_CENTER,
            margin: androidBannerBottomMargin,
            isTesting: useTestBannerAds,
          })
        } else {
          await AdMob.removeBanner()
        }
      } catch (error) {
        console.error('AdMob banner unavailable', error)

        if (isActive) {
          setShowAdFallback(view === 'results')
        }
      }
    }

    syncBanner()

    return () => {
      isActive = false

      if (Capacitor.isNativePlatform()) {
        AdMob.removeBanner().catch((error) => {
          console.error('AdMob banner cleanup failed', error)
        })
      }
    }
  }, [view])

  async function handlePanic() {
    if (isLoading) return

    setErrorMessage('')
    setGoogleErrorMessage('')
    setIsLoading(true)

    try {
      const nextLocation = await getCurrentLocation()

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
      }
    } catch {
      setLocation(null)
      setBathrooms([])
      setUsingDemoResults(false)
      setErrorMessage('Location needed to find nearby bathrooms.')
      setGoogleErrorMessage('')
      setView('location-error')
    } finally {
      setIsLoading(false)
    }
  }

  function handleBack() {
    setIsLoading(false)
    setView('panic')
  }

  if (view === 'results') {
    return (
      <main className="results-screen results-screen--with-ad" aria-label="Closest likely bathrooms">
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

        {showAdFallback && (
          <aside className="ad-placeholder" aria-label="Sponsored">
            <span>Sponsored</span>
            <p>AdMob banner</p>
          </aside>
        )}
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
