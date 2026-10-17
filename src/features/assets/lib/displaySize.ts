// How big a picture is drawn in the assets mosaic. The file itself is never changed: a picture bigger than 500 pixels
// either way is drawn at half size, and a smaller one at its own size.

export const LARGE_PICTURE = 500;

export function displaySize(width: number, height: number): { width: number; height: number; halved: boolean } {
	const halved = width > LARGE_PICTURE || height > LARGE_PICTURE;
	return halved ? { width: Math.round(width / 2), height: Math.round(height / 2), halved } : { width, height, halved };
}
