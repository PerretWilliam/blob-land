import { useEffect, useRef, useState } from "react";

/** True once the observed element has been visible in the viewport at least
 * once. A ref callback, not `useRef` + effect, so each card owns its own
 * observer and there's no need to collect/clean up a list of refs. */
export function useInView(): [(node: Element | null) => void, boolean] {
  const [inView, setInView] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const observed = useRef<Element | null>(null);

  // Inline ref callbacks are detached (null) and re-attached to the same
  // node on every render: keep watching it rather than start over each time,
  // which also re-fired the first callback (and a re-render) every render.
  function watch(node: Element) {
    observerRef.current?.disconnect();
    observed.current = node;
    observerRef.current = new IntersectionObserver(([entry]) => setInView(entry!.isIntersecting), {
      rootMargin: "200px",
    });
    observerRef.current.observe(node);
  }
  function ref(node: Element | null) {
    if (node && (node !== observed.current || !observerRef.current)) watch(node);
  }

  // Mounted again on the same node (StrictMode does it in dev): watch it again.
  useEffect(() => {
    if (observed.current && !observerRef.current) watch(observed.current);
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  return [ref, inView];
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
