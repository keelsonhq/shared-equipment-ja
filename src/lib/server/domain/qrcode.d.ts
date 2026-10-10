// The part of the `qrcode` package (CommonJS, no bundled types) this app uses.
// Declared here instead of adding @types/qrcode as a second dependency.
declare module 'qrcode' {
	interface ToStringOptions {
		type?: 'svg' | 'utf8' | 'terminal';
		errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
		margin?: number;
		width?: number;
		color?: { dark?: string; light?: string };
	}
	const QRCode: {
		toString(text: string, options?: ToStringOptions): Promise<string>;
	};
	export default QRCode;
}
