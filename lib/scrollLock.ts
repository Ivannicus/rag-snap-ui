/**
 * A reference-counted lock on the page's own scrolling, for as long as a popover is open.
 *
 * Why the popovers need it: a `team-member-select` panel is `position: fixed` at coordinates taken from
 * its trigger's bounding box *once*, at open time, so it cannot follow the trigger down the page — which
 * is why both selects close themselves when the page scrolls. That left a trap. The panel's own member
 * list scrolls, and a wheel that reaches the end of a scroll container chains to the next scrollable
 * ancestor, which is the document: scrolling to the last member therefore scrolled the page, the page's
 * scroll event fired, and the dropdown closed itself out from under the pointer.
 *
 * `overscroll-behavior: contain` on the panel stops that chaining. This stops the page moving at all, so
 * while a panel is open the only thing a wheel can scroll is the panel — anything else needs a click
 * outside first, which is also what dismisses the panel.
 *
 * Reference-counted because the caller is a component effect: two panels open at once would otherwise
 * have the second one's cleanup restore whatever the first had already changed. Only the outermost
 * release puts the original inline styles back.
 */

let locks = 0;
let previousOverflow = "";
let previousPaddingRight = "";

/**
 * Lock the page's scrolling. Returns the release function — call it once; a second call is ignored, so a
 * double cleanup cannot drop somebody else's lock.
 */
export function lockPageScroll(): () => void {
  const root = document.documentElement;

  if (locks === 0) {
    // The scrollbar's width has to be handed back as padding, or the page jumps sideways the moment it
    // stops being scrollable. Zero on overlay-scrollbar platforms, where nothing was taking up space and
    // nothing needs giving back.
    const scrollbarWidth = window.innerWidth - root.clientWidth;
    previousOverflow = root.style.overflow;
    previousPaddingRight = root.style.paddingRight;
    root.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      root.style.paddingRight = `${scrollbarWidth}px`;
    }
  }
  locks += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks -= 1;
    if (locks === 0) {
      root.style.overflow = previousOverflow;
      root.style.paddingRight = previousPaddingRight;
    }
  };
}
