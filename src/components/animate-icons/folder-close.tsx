'use client';

import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@/components/animate-icons/icon';

type FolderCloseProps = IconProps<keyof typeof animations>;

// A closed folder that swings its front panel open while the surrounding AnimateIcon is active, and shuts again afterwards.
// Built the Animate UI way (variants driven by the shared controls); the front panel is four straight points so `d` tweens.
const CLOSED = 'M2 9 L22 9 L22 19 L2 19 Z';
const OPEN = 'M6 12 L23 12 L20 19 L2 19 Z';

const animations = {
  default: {
    front: {
      initial: { d: CLOSED, transition: { duration: 0.25, ease: 'easeInOut' } },
      animate: { d: OPEN, transition: { duration: 0.3, ease: 'easeOut' } },
    },
    back: {},
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: FolderCloseProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);

  return (
    <motion.svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {/* The back of the folder with its tab, which stays put */}
      <path d="M2 19V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H20a2 2 0 0 1 2 2v1" />
      <motion.path d={CLOSED} variants={variants.front} initial="initial" animate={controls} />
    </motion.svg>
  );
}

function FolderClose(props: FolderCloseProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export { animations, FolderClose, type FolderCloseProps };
