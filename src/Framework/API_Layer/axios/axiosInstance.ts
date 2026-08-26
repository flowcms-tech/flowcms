import axios from 'axios'
import { applyAuthInterceptor } from './interceptors/authInterceptor'
import { applyErrorInterceptor } from './interceptors/errorInterceptor'

const axiosInstance = axios.create({
  /**
   * No baseURL, deliberately. Every call from the admin panel targets this
   * app's own `/api` routes, so a relative URL is both correct and portable.
   *
   * This used to be `process.env.NEXT_PUBLIC_BASE_URL`, and `NEXT_PUBLIC_*` is
   * inlined into the client bundle at build time — which host-locked the Docker
   * image. One image built for `http://localhost:3000` sent browser requests
   * there from every host it was ever deployed to, so the same artifact could
   * not be promoted from staging to production.
   *
   * Server-side URL generation is unaffected: canonicals, OG tags and sitemaps
   * read the DB-backed `baseUrl` with an env fallback, resolved at runtime.
   */
  withCredentials: false,
  timeout: 60_000,
  headers: {
    // Not forced to 'application/json' — axios sets that automatically for plain-object
    // payloads, and forcing it here would break multipart/form-data (file upload) requests,
    // which need the browser to set the Content-Type with its own boundary.
    Accept: 'application/json',
    'Cache-Control': 'no-store',
  },
})

applyAuthInterceptor(axiosInstance)
applyErrorInterceptor(axiosInstance)

export default axiosInstance
