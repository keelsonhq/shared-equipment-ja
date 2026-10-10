import QRCode from 'qrcode';

// QR code of an equipment page, for the asset tag label (DESIGN.md §9-B).
// The code holds the page URL: `KEELSON_APP_URL` when the platform injects it,
// else the origin the request came in on (local preview). Opening it goes
// through the normal sign-in, so the code itself grants nothing.

/** The equipment page URL a QR code points at. */
export function equipmentPageUrl(base: string, id: number): string {
	return `${base.replace(/\/+$/, '')}/equipment/${id}`;
}

/** An SVG image (markup) of the QR code for an equipment page. */
export function equipmentQrSvg(base: string, id: number): Promise<string> {
	return QRCode.toString(equipmentPageUrl(base, id), {
		type: 'svg',
		errorCorrectionLevel: 'M',
		margin: 1,
		color: { dark: '#1c1917', light: '#ffffff' },
	});
}
