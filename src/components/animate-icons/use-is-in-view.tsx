// Adapted from Animate UI (https://animate-ui.com), MIT licence, (c) Elliot Lenoir / imskyleen. Imports repointed to this project.
import * as React from 'react';
import { useInView, type UseInViewOptions } from 'motion/react';

interface UseIsInViewOptions {
  inView?: boolean;
  inViewOnce?: boolean;
  inViewMargin?: UseInViewOptions['margin'];
}

function useIsInView<T extends HTMLElement = HTMLElement>(
  ref: React.Ref<T>,
  options: UseIsInViewOptions = {},
) {
  const { inView, inViewOnce = false, inViewMargin = '0px' } = options;
  const localRef = React.useRef<T>(null);
  React.useImperativeHandle(ref, () => localRef.current as T);
  // An unattached ref makes useInView skip creating an IntersectionObserver, so buttons that never animate on view pay nothing
  const idleRef = React.useRef<T>(null);
  const inViewResult = useInView(inView ? localRef : idleRef, {
    once: inViewOnce,
    margin: inViewMargin,
  });
  const isInView = !inView || inViewResult;
  return { ref: localRef, isInView };
}

export { useIsInView, type UseIsInViewOptions };
