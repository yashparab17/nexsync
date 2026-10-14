// Small pixel-art glyphs (pixelarticons, MIT) for the terminal-flavoured corners of the app; they draw in the text colour.

import folder from "pixelarticons/svg/folder.svg?raw";
import human from "pixelarticons/svg/human.svg?raw";
import lock from "pixelarticons/svg/lock.svg?raw";

const ICONS = { folder, human, lock };

export default function PixelIcon({ name, className }: { name: keyof typeof ICONS; className?: string }) {
	return <span aria-hidden className={`inline-flex shrink-0 [&>svg]:size-full ${className ?? "size-5"}`} dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;
}
