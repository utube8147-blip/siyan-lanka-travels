# Motion components

Animations use [Motion](https://motion.dev) (`motion/react`). Everything is
wrapped in `<MotionConfig reducedMotion="user">` (see `MotionProvider.tsx`), so
people who turn on "Reduce motion" on their phone/computer get instant changes.

`BlurText.tsx` and `AnimatedNumber.tsx` are adapted from React Bits
(https://reactbits.dev, https://github.com/DavidHDev/react-bits):

> MIT + Commons Clause License Condition v1.0 — Copyright (c) David Haz.
> Permission is granted to use, copy, modify, merge, publish, and distribute
> the Software as part of an application, website, or product. The above
> copyright notice and this permission notice shall be included in all copies
> or substantial portions of the Software. The Commons Clause forbids selling
> the Software itself (e.g. as a component library).

Changes from the originals: BlurText can render as any heading and is read
as one phrase by screen readers; AnimatedNumber shows the real number in the
server HTML (good for SEO and screen readers) and re-animates when the value
changes (e.g. seats left updating live).
