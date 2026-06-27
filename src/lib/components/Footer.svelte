<script lang="ts">
	import { Separator } from '$lib/components/ui/separator';
	import { version } from '$app/environment';
	import * as m from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';

	const socials = [
		{
			name: 'Reddit',
			href: 'https://www.reddit.com/r/BCHCashTokens/',
			path:
				'M8.83852 12.4444C8.72864 12.6089 8.66999 12.8022 8.66999 13C8.66999 13.1313 8.69586 13.2614 8.74611 13.3827C8.79637 13.504 8.87003 13.6142 8.96289 13.7071C9.05574 13.8 9.16598 13.8736 9.28731 13.9239C9.40864 13.9741 9.53867 14 9.66999 14C9.86777 14 10.0611 13.9414 10.2256 13.8315C10.39 13.7216 10.5182 13.5654 10.5939 13.3827C10.6696 13.2 10.6894 12.9989 10.6508 12.8049C10.6122 12.6109 10.517 12.4327 10.3771 12.2929C10.2372 12.153 10.0591 12.0578 9.86508 12.0192C9.6711 11.9806 9.47004 12.0004 9.28731 12.0761C9.10458 12.1518 8.9484 12.28 8.83852 12.4444Z M12.01 16.52C12.8976 16.5568 13.7705 16.2847 14.48 15.75V15.79C14.5063 15.7644 14.5272 15.7339 14.5417 15.7002C14.5562 15.6664 14.5638 15.6302 14.5643 15.5935C14.5648 15.5569 14.558 15.5204 14.5444 15.4864C14.5308 15.4523 14.5106 15.4213 14.485 15.395C14.4594 15.3687 14.4289 15.3478 14.3951 15.3333C14.3614 15.3188 14.3252 15.3112 14.2885 15.3107C14.2145 15.3098 14.143 15.3383 14.09 15.39C13.4831 15.8254 12.7458 16.0406 12 16C11.2551 16.0333 10.5212 15.811 9.91999 15.37C9.86818 15.3275 9.8024 15.3057 9.73546 15.309C9.66851 15.3123 9.60518 15.3404 9.55778 15.3878C9.51039 15.4352 9.48231 15.4985 9.47903 15.5655C9.47574 15.6324 9.49747 15.6982 9.53999 15.75C10.2495 16.2847 11.1224 16.5568 12.01 16.52Z M13.7444 13.8715C13.9089 13.9814 14.1022 14.04 14.3 14.04L14.29 14.08C14.4256 14.0815 14.5601 14.0553 14.6852 14.0032C14.8104 13.9511 14.9237 13.874 15.0182 13.7767C15.1126 13.6795 15.1863 13.564 15.2348 13.4373C15.2832 13.3107 15.3054 13.1755 15.3 13.04C15.3 12.8422 15.2413 12.6489 15.1315 12.4844C15.0216 12.32 14.8654 12.1918 14.6827 12.1161C14.4999 12.0404 14.2989 12.0206 14.1049 12.0592C13.9109 12.0978 13.7327 12.193 13.5929 12.3329C13.453 12.4727 13.3578 12.6509 13.3192 12.8449C13.2806 13.0389 13.3004 13.24 13.3761 13.4227C13.4518 13.6054 13.58 13.7616 13.7444 13.8715Z M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12ZM18.4065 11.2154C18.5682 11.446 18.... (line truncated to 2000 chars)',
			viewBox: '0 0 24 24'
		},
		{
			name: 'X',
			href: 'https://x.com/Panmonicom',
			path:
				'M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.826Z',
			viewBox: '0 0 1200 1227'
		},
		{
			name: 'GitHub',
			href: 'https://github.com/Panmoni/tokenstork',
			path:
				'M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z',
			viewBox: '0 0 24 24'
		},
		{
			name: 'Telegram',
			href: 'https://t.me/Panmoni/487',
			path:
				'M22.122 10.040c0.006-0 0.014-0 0.022-0 0.209 0 0.403 0.065 0.562 0.177l-0.003-0.002c0.116 0.101 0.194 0.243 0.213 0.403l0 0.003c0.020 0.122 0.031 0.262 0.031 0.405 0 0.065-0.002 0.129-0.007 0.193l0-0.009c-0.225 2.369-1.201 8.114-1.697 10.766-0.21 1.123-0.623 1.499-1.023 1.535-0.869 0.081-1.529-0.574-2.371-1.126-1.318-0.865-2.063-1.403-3.342-2.246-1.479-0.973-0.52-1.51 0.322-2.384 0.221-0.23 4.052-3.715 4.127-4.031 0.004-0.019 0.006-0.040 0.006-0.062 0-0.078-0.029-0.149-0.076-0.203l0 0c-0.052-0.034-0.117-0.053-0.185-0.053-0.045 0-0.088 0.009-0.128 0.024l0.002-0.001q-0.198 0.045-6.316 4.174c-0.445 0.351-1.007 0.573-1.619 0.599l-0.006 0c-0.867-0.105-1.654-0.298-2.401-0.573l0.074 0.024c-0.938-0.306-1.683-0.467-1.619-0.985q0.051-0.404 1.114-0.827 6.548-2.853 8.733-3.761c1.607-0.853 3.47-1.555 5.429-2.010l0.157-0.031zM15.93 1.025c-8.302 0.020-15.025 6.755-15.025 15.060 0 8.317 6.742 15.060 15.060 15.060s15.060-6.742 15.060-15.060c0-8.305-6.723-15.040-15.023-15.060h-0.002q-0.035-0 -0.070 0z',
			viewBox: '0 0 32 32'
		},
		{
			name: 'YouTube',
			href: 'https://www.youtube.com/@bchworks',
			path:
				'M508.64,148.79c0-45-33.1-81.2-74-81.2C379.24,65,322.74,64,265,64H247c-57.6,0-114.2,1-169.6,3.6-40.8,0-73.9,36.4-73.9,81.4C1,184.59-.06,220.19,0,255.79q-.15,53.4,3.4,106.9c0,45,33.1,81.5,73.9,81.5,58.2,2.7,117.9,3.9,178.6,3.8q91.2.3,178.6-3.8c40.9,0,74-36.5,74-81.5,2.4-35.7,3.5-71.3,3.4-107Q512.24,202.29,508.64,148.79ZM207,353.89V157.39l145,98.2Z',
			viewBox: '0 0 512 512'
		},
		{
			name: 'Instagram',
			href: 'https://www.instagram.com/bchworks',
			path:
				'M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 011.772 1.153 4.902 4.902 0 011.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 01-1.153 1.772 4.902 4.902 0 01-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 01-1.772-1.153 4.902 4.902 0 01-1.153-1.772c-.247-.636-.416-1.363-.465-2.427-.047-1.024-.06-1.379-.06-3.808v-.63c0-2.43.013-2.784.06-3.808.049-1.064.218-1.791.465-2.427a4.902 4.902 0 011.153-1.772A4.902 4.902 0 015.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 00-.748-1.15 3.098 3.098 0 00-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 110 10.27 5.135 5.135 0 010-10.27zm0 1.802a3.333 3.333 0 100 6.666 3.333 3.333 0 000-6.666zm5.338-3.205a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z',
			viewBox: '0 0 24 24'
		}
	];

	const techStack = [
		{
			name: 'Svelte',
			href: 'https://svelte.dev',
			path: 'M19.6 2.7c-2.3.2-4.2 1.6-5.2 3.5-.3-.1-.6-.2-1-.2-.5 0-1 .1-1.4.3C10.9 4.5 9 3.2 6.7 2.9 5.5 2.7 4.2 3 3.2 3.6c1.7 2.8 4.5 4.7 7.8 5h.1c.3 0 .7 0 1-.1 3.3-.3 6.1-2.3 7.8-5-.9-.5-2.1-.9-3.3-.8zM4.8 15.3c.8 1.5 2.1 2.7 3.6 3.5 1.5.9 3.2 1.3 4.9 1.2 1.9.1 3.7-.4 5.3-1.4 1.5-1 2.7-2.4 3.3-4-.8.2-1.7.3-2.5.2-2-.2-3.9-1.2-5.2-2.7-.3.2-.6.4-1 .5-.4.1-.9.2-1.3.1-.4 0-.8-.1-1.2-.3-1.4 1.5-3.3 2.5-5.5 2.6-.8 0-1.7-.1-2.4-.3l-.1-.4z',
			viewBox: '0 0 24 24'
		},
		{
			name: 'TypeScript',
			href: 'https://www.typescriptlang.org',
			path: 'M1.125 0C.502 0 0 .502 0 1.125v21.75C0 23.498.502 24 1.125 24h21.75c.623 0 1.125-.502 1.125-1.125V1.125C24 .502 23.498 0 22.875 0zm17.363 9.75c.612 0 1.154.037 1.627.111a6.38 6.38 0 011.306.34v2.458a3.95 3.95 0 00-.643-.361 5.093 5.093 0 00-.717-.26 5.453 5.453 0 00-1.426-.2c-.3 0-.573.028-.819.086a2.1 2.1 0 00-.623.242c-.17.104-.3.229-.393.374a.888.888 0 00-.14.49c0 .196.053.373.156.529.104.156.252.304.443.444s.423.276.696.41c.273.135.582.274.926.416.47.197.892.407 1.266.628.374.222.695.473.963.753.268.279.472.598.614.957.142.359.214.776.214 1.253 0 .657-.125 1.21-.373 1.656a3.033 3.033 0 01-1.012 1.085 4.38 4.38 0 01-1.487.596c-.566.12-1.163.18-1.79.18a9.916 9.916 0 01-1.84-.164 5.544 5.544 0 01-1.512-.493v-2.63a5.033 5.033 0 003.237 1.2c.333 0 .624-.03.872-.09.249-.06.456-.144.623-.25.166-.108.29-.234.373-.38a1.023 1.023 0 00-.074-1.089 2.12 2.12 0 00-.537-.5 5.597 5.597 0 00-.807-.444 27.72 27.72 0 00-1.007-.436c-.918-.383-1.602-.852-2.053-1.405-.45-.553-.676-1.222-.676-2.005 0-.614.123-1.141.369-1.582.246-.441.58-.804 1.004-1.089a4.494 4.494 0 011.47-.629 7.536 7.536 0 011.77-.201zm-15.113.188h3.87v1.575H8.495v8.362H6.12v-8.362H3.375z',
			viewBox: '0 0 24 24'
		},
		{
			name: 'Tailwind CSS',
			href: 'https://tailwindcss.com',
			path: 'M12.001 4.8c-3.2 0-5.2 1.6-6 4.8 1.2-1.6 2.6-2.2 4.2-1.8.913.228 1.565.89 2.288 1.624C13.666 10.618 15.027 12 18.001 12c3.2 0 5.2-1.6 6-4.8-1.2 1.6-2.6 2.2-4.2 1.8-.913-.228-1.565-.89-2.288-1.624C16.337 6.182 14.976 4.8 12.001 4.8zm-6 7.2c-3.2 0-5.2 1.6-6 4.8 1.2-1.6 2.6-2.2 4.2-1.8.913.228 1.565.89 2.288 1.624 1.177 1.194 2.538 2.576 5.512 2.576 3.2 0 5.2-1.6 6-4.8-1.2 1.6-2.6 2.2-4.2 1.8-.913-.228-1.565-.89-2.288-1.624C10.337 13.382 8.976 12 6.001 12z',
			viewBox: '0 0 24 24'
		},
		{
			name: 'Rust',
			href: 'https://www.rust-lang.org',
			path: 'M12 0C5.373 0 0 5.373 0 12c0 .742.078 1.465.214 2.172a6.62 6.62 0 011.211-.164c1.185 0 2.03.357 3.044.918.836.462 1.79 1.013 3.146 1.013 1.047 0 1.846-.318 2.554-.695.749-.4 1.361-.71 2.254-.71.662 0 1.31.15 1.913.433a4.43 4.43 0 01.127 1.418c0 1.47-.576 2.809-1.512 3.807A9.963 9.963 0 0012 22c5.523 0 10-4.477 10-10S17.523 0 12 0zm1.3 17.4h-.6v-.7h.6v.7zm-.6-1.8h.6v-5h-.6v5zm3.9-8.2c-.763 0-1.434.28-1.94.74l.56 1.01c.38-.27.83-.45 1.35-.45.67 0 1.2.25 1.2.85 0 .52-.36.7-1.2.7h-.23v1.1h.25c.98 0 1.5.36 1.5 1 0 .62-.59.92-1.32.92-.6 0-1.14-.22-1.54-.6l-.58 1.04c.55.44 1.26.76 2.18.76 1.77 0 2.67-.95 2.67-2.14 0-.76-.44-1.39-1.13-1.74.53-.22.85-.79.85-1.44 0-1.44-1.16-2.21-2.5-2.21z',
			viewBox: '0 0 24 24'
		},
		{
			name: 'PostgreSQL',
			href: 'https://www.postgresql.org',
			path: 'M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm-.07 17.95c-.368.023-.657-.025-.88-.15-.196-.11-.35-.27-.477-.474-.091-.146-.193-.212-.326-.169-.172.057-.29.173-.363.361-.096.244-.09.502-.07.76.007.073.056.136.065.208.01.069-.041.163-.112.149-.425-.083-.728-.398-.87-.808-.128-.368-.086-.759.002-1.136.027-.114.067-.224.103-.336.039-.117.08-.232.112-.35.085-.317.19-.626.317-.927.09-.215.197-.425.315-.626.088-.15.18-.297.275-.442.09-.137.18-.27.275-.397.065-.084.14-.157.202-.24l-.31-.023c-.252.02-.493-.084-.709-.23-.16-.11-.3-.249-.44-.387-.134-.132-.26-.27-.4-.394-.162-.143-.25-.323-.257-.528a.564.564 0 01.15-.422c.168-.186.38-.258.62-.237.196.016.371.095.53.22.075.058.15.114.22.173l.065.053v-.039c-.001-.277.288-.501.568-.489.327.014.518.253.48.571-.023.174-.103.315-.247.417-.104.073-.16.064-.233-.013-.07-.075-.14-.148-.22-.21-.166-.131-.348-.18-.56-.115-.177.054-.28.193-.298.369-.018.17.033.316.17.426.166.133.344.228.528.303.355.145.723.212 1.099.247.155.014.186.06.193.199.01.195-.07.314-.242.362-.224.062-.438-.034-.645-.135-.064-.031-.122-.073-.183-.11-.146-.09-.293-.088-.44.001-.212.13-.35.33-.464.558-.107.217-.194.444-.268.676-.075.236-.14.474-.202.713-.048.184-.093.37-.14.552l-.057.22c-.05.198-.068.402-.029.604.03.155.085.3.148.44.058.126.119.241.198.34.135.166.3.238.509.229.095-.004.221-.03.366-.159.187-.165.263-.38.263-.612 0-.128-.023-.251-.029-.378-.008-.173.06-.298.241-.32.202-.023.373.08.43.286.07.244.009.474-.074.698-.079.211-.19.4-.331.566-.138.164-.3.296-.49.391-.118.058-.243.1-.37.127.105.04.214.059.323.07.286.022.556-.091.771-.306.19-.188.34-.413.478-.656.068-.118.136-.236.188-.366l.016-.048z',
			viewBox: '0 0 24 24'
		},
		{
			name: 'Cloudflare',
			href: 'https://www.cloudflare.com',
			path: 'M16.509 16.844c.148-.032.285-.1.405-.2l.03-.028c.205-.172.366-.39.47-.638.098-.258.133-.535.1-.81-.032-.284-.124-.554-.27-.795l-2.92-4.752-.711-1.158c-.066-.091-.098-.195-.094-.3.005-.11.04-.216.1-.309.06-.092.144-.168.244-.22.1-.052.213-.079.327-.077h6.77l.13.006c.541.052.88.33.946.77.033.231-.021.466-.154.658l-3.29 3.97c-.12.147-.22.307-.296.476l-.085.22c-.086.236-.1.49-.037.733.075.234.22.438.415.581.1.07.21.126.325.165.182.065.375.1.57.103.296.003.585-.096.816-.28l.006-.004 2.908-2.39c.304-.246.671-.4 1.058-.443.517-.063 1.007.181 1.291.58.283.407.315.938.082 1.395-.216.412-.6.713-1.054.828l-7.323 1.928-.45.118c-.195.043-.39.05-.586.086-.177.031-.352.065-.525.09zM7.308 5.085l-.01-.002C4.15 4.566 1.56 7.276 2.13 10.399c.286 1.528 1.424 2.731 2.963 3.279l.087.027 4.257 1.232c.195.04.386.105.58.142.178.034.355.07.527.108l.727.195.11.028c.614.155 1.04.217 1.48.308.425.102.846.222 1.256.388.396.158.774.37 1.122.628.355.272.65.617.86 1.016.194.373.31.78.342 1.197.034.425-.016.851-.15 1.258-.14.429-.36.829-.648 1.18-.167.21-.354.406-.558.587l-.06.046c-.444.368-.965.635-1.526.782-.573.159-1.17.21-1.762.152l-8.283-.85-.14-.013C1.116 21.212-.243 18.772.035 15.573c.161-1.89 1.175-3.493 2.696-4.442 1.378-.88 3.026-1.143 4.577-.735v.69z',
			viewBox: '0 0 24 24'
		},
		{
			name: 'BCH',
			href: 'https://bitcoincash.org',
			path: 'M12 0C5.373 0 0 5.373 0 12c0 6.628 5.373 12 12 12s12-5.372 12-12c0-6.627-5.373-12-12-12zm3.202 7.005c.433-.107.862-.05 1.247.207.373.278.575.681.591 1.18.005.156-.02.31-.07.456-.058.17-.14.325-.242.464-.094.128-.206.237-.33.33l.228.132c.362.263.554.643.531 1.088-.019.362-.15.696-.382.962-.253.288-.59.47-.979.572l-1.14.307.424 1.376-.966.302-.425-1.376-.785.255.127.545-.935.298-.348-1.197-1.455.467-.3-.953 1.455-.463-.685-2.21.958-.3.683 2.21 1.003-.316.41 1.336zM9.6 11.48l1.518-.492-.544-1.764-1.519.493zm2.666 3.308l.545 1.764 1.516-.491-.546-1.764-1.515.491z',
			viewBox: '0 0 24 24'
		}
	];
</script>

<footer class="mt-12 border-t ts-border-subtle ts-surface-soft">
	<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
		<!--
			Footer nav mirrors the header's four primary sections — Tokens,
			Stats, Tools, About — using the same message keys and hrefs so the
			two stay in sync. Legal links (Terms, Privacy) live under About,
			matching where the header keeps them out of primary nav.
		-->
		<div class="grid gap-8 md:grid-cols-2 lg:grid-cols-6">
			<div class="md:col-span-2">
				<div class="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-lg">
					<img src="/TokenStorkRegistry-icon.png" alt="" class="h-8 w-8" />
					<span>TokenStork</span>
				</div>
				<p class="mt-3 text-sm max-w-sm ts-text-body">
					{m.footer_tagline_before()}
					<a
						href="https://bchworks.com/"
						target="_blank"
						rel="noopener noreferrer"
						class="text-violet-600 dark:text-violet-400 hover:underline"
					>BCHWorks.com</a>
					{m.footer_tagline_after()}
				</p>
				<a
					href="mailto:hello@panmoni.com"
					class="mt-3 inline-block text-sm hover:text-violet-600 dark:hover:text-violet-400 ts-text-strong"
				>
					hello@panmoni.com
				</a>
			</div>

			<div>
				<h3 class="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
					{m.nav_tokens()}
				</h3>
				<ul class="mt-4 space-y-2 text-sm">
					<li><a href={localizeHref('/')} class="hover:text-violet-600 dark:hover:text-violet-400 ts-text-body">{m.nav_tokens_all()}</a></li>
					<li><a href={localizeHref('/crc20')} class="hover:text-violet-600 dark:hover:text-violet-400 ts-text-body">{m.nav_crc20()}</a></li>
				</ul>
			</div>

			<div>
				<h3 class="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
					{m.nav_stats()}
				</h3>
				<ul class="mt-4 space-y-2 text-sm">
					<li><a href={localizeHref('/stats')} class="hover:text-violet-600 dark:hover:text-violet-400 ts-text-body">{m.nav_stats()}</a></li>
					<li><a href={localizeHref('/briefing')} class="hover:text-violet-600 dark:hover:text-violet-400 ts-text-body">Stork Sightings</a></li>
					<li><a href={localizeHref('/mining')} class="hover:text-violet-600 dark:hover:text-violet-400 ts-text-body">{m.nav_mining()}</a></li>
					<li><a href={localizeHref('/blocks')} class="hover:text-violet-600 dark:hover:text-violet-400 ts-text-body">{m.nav_blocks()}</a></li>
				</ul>
			</div>

			<div>
				<h3 class="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
					{m.nav_tools()}
				</h3>
				<ul class="mt-4 space-y-2 text-sm">
					<li><a href={localizeHref('/mint')} class="hover:text-violet-600 dark:hover:text-violet-400 ts-text-body">{m.nav_mint()}</a></li>
					<li><a href={localizeHref('/airdrops/new')} class="hover:text-violet-600 dark:hover:text-violet-400 ts-text-body">{m.nav_airdrop()}</a></li>
					<li><a href={localizeHref('/arbitrage')} class="hover:text-violet-600 dark:hover:text-violet-400 ts-text-body">{m.nav_arbitrage()}</a></li>
				</ul>
			</div>

			<div>
				<h3 class="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
					{m.nav_about()}
				</h3>
				<ul class="mt-4 space-y-2 text-sm">
					<li><a href={localizeHref('/about')} class="hover:text-violet-600 dark:hover:text-violet-400 ts-text-body">{m.nav_about()}</a></li>
					<li><a href={localizeHref('/faq')} class="hover:text-violet-600 dark:hover:text-violet-400 ts-text-body">{m.nav_faq()}</a></li>
					<li><a href={localizeHref('/learn')} class="hover:text-violet-600 dark:hover:text-violet-400 ts-text-body">{m.nav_learn()}</a></li>
					<li><a href={localizeHref('/roadmap')} class="hover:text-violet-600 dark:hover:text-violet-400 ts-text-body">{m.nav_roadmap()}</a></li>
					<li><a href={localizeHref('/terms')} class="hover:text-violet-600 dark:hover:text-violet-400 ts-text-body">{m.footer_legal_terms()}</a></li>
					<li><a href={localizeHref('/privacy')} class="hover:text-violet-600 dark:hover:text-violet-400 ts-text-body">{m.footer_legal_privacy()}</a></li>
				</ul>
			</div>
		</div>

		<Separator class="my-8 bg-slate-200 dark:bg-zinc-800" />

		<div class="flex flex-col sm:flex-row items-center justify-between gap-6">
			<div class="flex items-center gap-5">
				{#each socials as s (s.name)}
					<a
						href={s.href}
						target="_blank"
						rel="noopener noreferrer"
						class="hover:text-violet-600 dark:hover:text-violet-400 transition-colors ts-text-muted"
					>
						<span class="sr-only">{s.name}</span>
						<svg class="w-5 h-5" aria-hidden="true" fill="currentColor" viewBox={s.viewBox} xmlns="http://www.w3.org/2000/svg">
							<path fill-rule="evenodd" clip-rule="evenodd" d={s.path} />
						</svg>
					</a>
				{/each}
			</div>

			<p class="text-sm text-center sm:text-right ts-text-body">
				{m.footer_project_before()}
				<img src="/panmoni.svg" alt="" class="inline h-[1em] w-[1em] align-[-0.15em] mx-0.5" aria-hidden="true" />
				<a
					href="https://www.panmoni.com/"
					target="_blank"
					rel="noopener noreferrer"
					title="Panmoni is a Web3 product studio"
					class="gradient-link tracking-wider font-bold bg-clip-text text-transparent bg-gradient-to-r from-[#00abda] to-[#1476ff]"
				>Panmoni</a>{m.footer_project_after()} · v{version} <span class="font-mono text-xs ts-text-muted" title="Git commit hash of this build">({__GIT_COMMIT__})</span> (alpha) · {m.footer_prices_usd()}
			</p>
		</div>

		<div class="flex items-center justify-center gap-5 mt-6 flex-wrap">
			{#each techStack as t (t.name)}
				<a
					href={t.href}
					target="_blank"
					rel="noopener noreferrer"
					title={t.name}
					class="inline-flex items-center gap-1.5 text-xs ts-text-muted hover:text-slate-700 dark:hover:text-zinc-100 transition-colors"
				>
					<svg class="h-3.5 w-3.5" aria-hidden="true" fill="currentColor" viewBox={t.viewBox} xmlns="http://www.w3.org/2000/svg">
						<path d={t.path} />
					</svg>
					<span>{t.name}</span>
				</a>
			{/each}
		</div>

		<Separator class="my-8 bg-slate-200 dark:bg-zinc-800" />

		<!--
			Risk / financial disclaimer + alpha-tooling notice are kept in
			English (the authoritative version) — same policy as the legal
			pages (/terms, /privacy, /tos). Only the internal links are
			localized so a non-English visitor stays in their locale.
		-->
		<p class="text-xs leading-relaxed ts-text-muted">
			<strong class="ts-text-strong">Disclaimer:</strong>
			Cryptocurrency investments carry a high degree of risk, and may not be suitable for all
			investors. Before deciding to trade cryptocurrencies, you should carefully consider your
			investment objectives, level of experience, and risk appetite. The possibility exists that
			you could sustain a loss of some or all of your initial investment. Therefore, you should
			not invest money that you cannot afford to lose. This website is for informational purposes
			only and is not intended to provide specific financial, investment, tax, legal, accounting
			or other advice.
		</p>
		<p class="text-xs leading-relaxed mt-3 ts-text-muted">
			<strong class="ts-text-strong">Alpha tooling:</strong>
			the <a href={localizeHref('/mint')} class="underline hover:text-violet-600">mint</a> and
			<a href={localizeHref('/airdrops/new')} class="underline hover:text-violet-600">airdrop</a>
			tools build and broadcast real BCH transactions through code that has not been independently
			audited. They are alpha software, untested at scale, and provided as-is. Use them at your own
			risk; test with a low-stakes wallet first; verify every output in your wallet's pre-sign
			review. See the <a href={localizeHref('/terms#tools-alpha')} class="underline hover:text-violet-600">Terms</a>
			for the full disclaimer.
		</p>
	</div>
</footer>
