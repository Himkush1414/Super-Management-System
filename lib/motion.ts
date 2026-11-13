/**
 * framer-motion's full `motion` component put about 40 KB (gzip) on every
 * dashboard page before it could respond. `m` elements inside <LazyMotion>
 * are about 6 KB; the animation code arrives in its own chunk right after,
 * long before a dialog or the phone menu is opened. Same animations.
 */
export const loadMotion = () => import("./motion-features").then((mod) => mod.default);
