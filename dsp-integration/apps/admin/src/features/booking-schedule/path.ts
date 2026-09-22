/* The booking schedule opens as its own page, in a new tab (Rob, 20 Sep),
   so it can be left open beside the rest of HQ Admin. */
export const BOOKING_SCHEDULE_PATH = '/booking-schedule'

/* A route as a URL for a new tab. The app's own links go through the router,
   which knows where it is mounted; window.open does not. The hosted
   prototype routes in the hash and sits under a base path, so opening a bare
   "/booking-schedule" there asks the host for a page it has never had — a
   404 (ticket d5lCFNAL). Built from the base Vite gave us, it is right
   wherever the bundle is served from. */
export const externalUrl = (route: string) =>
  import.meta.env.VITE_DEMO === '1' ? `${import.meta.env.BASE_URL}#${route}` : route
