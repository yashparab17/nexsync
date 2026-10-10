import { motion, type TargetAndTransition, type Variants } from 'motion/react';
import type { LucideIcon } from 'lucide-react';

import { useAnimateIconContext } from './icon';

// For lucide icons Animate UI has no hand-built version of: the whole glyph plays one small motion
// whenever the surrounding AnimateIcon (a Button, a nav link, a card) says so. Same trigger API as the real ones.
const presets = {
  pop: { scale: [1, 1.18, 1], transition: { duration: 0.35, ease: 'easeOut' } },
  tilt: { rotate: [0, -14, 12, -6, 0], transition: { duration: 0.5, ease: 'easeInOut' } },
  nudge: { y: [0, -3, 0], transition: { duration: 0.35, ease: 'easeOut' } },
  slide: { x: [0, 3, 0], transition: { duration: 0.35, ease: 'easeOut' } },
  diag: { x: [0, 2.5, 0], y: [0, -2.5, 0], transition: { duration: 0.35, ease: 'easeOut' } },
  shake: { x: [0, -2, 2, -2, 2, 0], transition: { duration: 0.4, ease: 'easeInOut' } },
  back: { rotate: [0, -360], transition: { duration: 0.6, ease: 'easeInOut' } },
} satisfies Record<string, TargetAndTransition>;

export type Preset = keyof typeof presets;

export function motionIcon(Icon: LucideIcon, preset: Preset = 'pop') {
  const Motion = motion.create(Icon);
  const variants: Variants = { initial: { scale: 1, rotate: 0, x: 0, y: 0 }, animate: presets[preset] as TargetAndTransition };
  return function AnimatedIcon(props: React.ComponentProps<LucideIcon>) {
    const { controls } = useAnimateIconContext();
    return <Motion initial="initial" animate={controls} variants={variants} {...(props as object)} />;
  };
}
