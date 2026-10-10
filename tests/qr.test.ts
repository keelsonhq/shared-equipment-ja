import { describe, expect, it } from 'vite-plus/test';
import { equipmentPageUrl, equipmentQrSvg } from '#lib/server/domain/qr.ts';

describe('QR code', () => {
	it('points at the equipment page of the given base URL', () => {
		expect(equipmentPageUrl('https://acme--equipment.example.test/', 12)).toBe(
			'https://acme--equipment.example.test/equipment/12',
		);
	});

	it('is an SVG image', async () => {
		const svg = await equipmentQrSvg('http://localhost:5173', 3);
		expect(svg.startsWith('<svg')).toBe(true);
		expect(svg).toContain('</svg>');
	});
});
