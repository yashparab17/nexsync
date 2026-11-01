import { describe, expect, it } from "vitest";

import { clock, crisp, fitSlide, pickAudienceMonitor } from "@/features/office/slides/lib/show";

const monitor = (name: string, x: number) => ({ name, position: { x, y: 0 }, size: { width: 1920, height: 1080 } });

describe("the slide show", () => {
	it("puts the audience on the screen the presenter is not on, and nowhere when there is one screen", () => {
		const laptop = monitor("laptop", 0);
		const projector = monitor("projector", 1920);
		expect(pickAudienceMonitor([laptop, projector], laptop)).toBe(projector);
		expect(pickAudienceMonitor([projector, laptop], laptop)).toBe(projector);
		expect(pickAudienceMonitor([laptop], laptop)).toBeNull();
		expect(pickAudienceMonitor([laptop, projector], null)).toBe(laptop);
	});

	it("writes a timer as minutes and seconds, with hours when needed", () => {
		expect([0, 7_000, 723_000, 3_729_000, -5].map(clock)).toEqual(["0:00", "0:07", "12:03", "1:02:09", "0:00"]);
	});

	it("draws a slide so that each of its pixels is one pixel of the screen", () => {
		// 1280 wide at 150% scaling is 1920 device pixels for a 960 pt slide: 2 pixels per point
		expect(crisp(1280, 960, 1.5)).toEqual({ scale: 2, width: 1280 });
		// A width that does not divide evenly is moved to the nearest one that does, never stretched
		const c = crisp(1000, 960, 1.25);
		expect(c.width * 1.25).toBeCloseTo(960 * c.scale, 6);
		expect(Math.round(960 * c.scale)).toBe(960 * c.scale);
	});

	it("fits a slide to a screen of another shape", () => {
		expect(fitSlide({ w: 1920, h: 1080 }, 960, 540)).toBe(1920);
		expect(fitSlide({ w: 1920, h: 1200 }, 960, 540)).toBe(1920);
		expect(fitSlide({ w: 1600, h: 900 }, 960, 720)).toBe(1200);
	});
});
