/* The landing page and both studios share one public origin. Relative URLs are
   mandatory: local Next rewrites, ECS ingress, and CDN routing may use different
   hosts internally, but the browser must never leave the canonical frontend. */
export const MATH_STUDIO_URL = "/math";
export const TIKZ_STUDIO_URL = "/tikz";
