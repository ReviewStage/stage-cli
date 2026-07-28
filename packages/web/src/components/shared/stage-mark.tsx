import type { SVGProps } from "react";

export function StageMark({
	size = 20,
	fill,
	...props
}: { size?: number } & SVGProps<SVGSVGElement>) {
	const contentWidth = 430.1;
	const contentHeight = 311.8;
	const aspectRatio = contentWidth / contentHeight;
	const fillColor = fill || "#2d7a4e";

	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width={size * aspectRatio}
			height={size}
			viewBox="41 100.1 430.1 311.8"
			fill="none"
			aria-hidden="true"
			{...props}
		>
			<rect
				x="170.0"
				y="100.1"
				width="172.0"
				height="53.8"
				rx="26.9"
				fill={fillColor}
				opacity="0.9"
			/>
			<rect
				x="127.0"
				y="186.1"
				width="258.0"
				height="53.8"
				rx="26.9"
				fill={fillColor}
				opacity="0.65"
			/>
			<rect
				x="84.0"
				y="272.1"
				width="344.1"
				height="53.8"
				rx="26.9"
				fill={fillColor}
				opacity="0.4"
			/>
			<rect
				x="41.0"
				y="358.1"
				width="430.1"
				height="53.8"
				rx="26.9"
				fill={fillColor}
				opacity="0.2"
			/>
		</svg>
	);
}
