<script lang="ts">
	import { humanizeNumericSupply, formatMarketCap, stripEmoji } from '$lib/format';
	import { iconHrefFor } from '$lib/icons';
	import {
		REPORT_REASONS,
		REPORT_REASON_LABELS,
		type ReportReason
	} from '$lib/moderation';
	import Crc20Badge from '$lib/components/Crc20Badge.svelte';
	import FormatCategory from '$lib/components/FormatCategory.svelte';
	import PriceChart from '$lib/components/PriceChart.svelte';
	import StarButton from '$lib/components/StarButton.svelte';
	import VoteButton from '$lib/components/VoteButton.svelte';
	import { Tooltip, TooltipTrigger, TooltipContent } from '$lib/components/ui/tooltip';

	let { data } = $props();

	// Well-known BCMR URI keys → inline SVG icons. Paths copied from the
	// Footer's social-icon block so the brand marks stay consistent
	// across the site. Anything not listed here renders with the generic
	// link icon + the key name as a label.
	type IconSpec = { viewBox: string; paths: string[]; label: string };
	const URI_ICONS: Record<string, IconSpec> = {
		web: {
			viewBox: '0 0 24 24',
			label: 'Website',
			paths: [
				'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
				'M3.6 9h16.8',
				'M3.6 15h16.8',
				'M11.5 3a17 17 0 0 0 0 18',
				'M12.5 3a17 17 0 0 1 0 18'
			]
		},
		x: {
			viewBox: '0 0 1200 1227',
			label: 'X (Twitter)',
			paths: [
				'M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.826Z'
			]
		},
		twitter: {
			viewBox: '0 0 1200 1227',
			label: 'Twitter',
			paths: [
				'M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.826Z'
			]
		},
		github: {
			viewBox: '0 0 24 24',
			label: 'GitHub',
			paths: [
				'M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z'
			]
		},
		telegram: {
			viewBox: '0 0 24 24',
			label: 'Telegram',
			paths: [
				'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z'
			]
		},
		reddit: {
			viewBox: '0 0 24 24',
			label: 'Reddit',
			paths: [
				'M8.83852 12.4444C8.72864 12.6089 8.66999 12.8022 8.66999 13C8.66999 13.1313 8.69586 13.2614 8.74611 13.3827C8.79637 13.504 8.87003 13.6142 8.96289 13.7071C9.05574 13.8 9.16598 13.8736 9.28731 13.9239C9.40864 13.9741 9.53867 14 9.66999 14C9.86777 14 10.0611 13.9414 10.2256 13.8315C10.39 13.7216 10.5182 13.5654 10.5939 13.3827C10.6696 13.2 10.6894 12.9989 10.6508 12.8049C10.6122 12.6109 10.517 12.4327 10.3771 12.2929C10.2372 12.153 10.0591 12.0578 9.86508 12.0192C9.6711 11.9806 9.47004 12.0004 9.28731 12.0761C9.10458 12.1518 8.9484 12.28 8.83852 12.4444Z',
				'M12.01 16.52C12.8976 16.5568 13.7705 16.2847 14.48 15.75V15.79C14.5063 15.7644 14.5272 15.7339 14.5417 15.7002C14.5562 15.6664 14.5638 15.6302 14.5643 15.5935C14.5648 15.5569 14.558 15.5204 14.5444 15.4864C14.5308 15.4523 14.5106 15.4213 14.485 15.395C14.4594 15.3687 14.4289 15.3478 14.3951 15.3333C14.3614 15.3188 14.3252 15.3112 14.2885 15.3107C14.2145 15.3098 14.143 15.3383 14.09 15.39C13.4831 15.8254 12.7458 16.0406 12 16C11.2551 16.0333 10.5212 15.811 9.91999 15.37C9.86818 15.3275 9.8024 15.3057 9.73546 15.309C9.66851 15.3123 9.60518 15.3404 9.55778 15.3878C9.51039 15.4352 9.48231 15.4985 9.47903 15.5655C9.47574 15.6324 9.49747 15.6982 9.53999 15.75C10.2495 16.2847 11.1224 16.5568 12.01 16.52Z',
				'M13.7444 13.8715C13.9089 13.9814 14.1022 14.04 14.3 14.04L14.29 14.08C14.4256 14.0815 14.5601 14.0553 14.6852 14.0032C14.8104 13.9511 14.9237 13.874 15.0182 13.7767C15.1126 13.6795 15.1863 13.564 15.2348 13.4373C15.2832 13.3107 15.3054 13.1755 15.3 13.04C15.3 12.8422 15.2413 12.6489 15.1315 12.4844C15.0216 12.32 14.8654 12.1918 14.6827 12.1161C14.4999 12.0404 14.2989 12.0206 14.1049 12.0592C13.9109 12.0978 13.7327 12.193 13.5929 12.3329C13.453 12.4727 13.3578 12.6509 13.3192 12.8449C13.2806 13.0389 13.3004 13.24 13.3761 13.4227C13.4518 13.6054 13.58 13.7616 13.7444 13.8715Z',
				'M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12ZM18.4065 11.2154C18.5682 11.446 18.6597 11.7185 18.67 12C18.6743 12.2755 18.6005 12.5467 18.4571 12.782C18.3138 13.0174 18.1068 13.2073 17.86 13.33C17.8713 13.4765 17.8713 13.6236 17.86 13.77C17.86 16.01 15.25 17.83 12.03 17.83C8.80999 17.83 6.19999 16.01 6.19999 13.77C6.18873 13.6236 6.18873 13.4765 6.19999 13.33C6.00765 13.2416 5.83683 13.1125 5.69935 12.9515C5.56188 12.7906 5.46105 12.6017 5.40384 12.3979C5.34664 12.1941 5.33443 11.9803 5.36807 11.7713C5.4017 11.5623 5.48038 11.3632 5.59864 11.1876C5.71689 11.0121 5.87191 10.8643 6.05294 10.7546C6.23397 10.645 6.43669 10.5759 6.64705 10.5524C6.8574 10.5288 7.07036 10.5513 7.27117 10.6182C7.47198 10.6852 7.65583 10.795 7.80999 10.94C8.96227 10.1585 10.3179 9.73099 11.71 9.71L12.45 6.24C12.4583 6.19983 12.4745 6.16171 12.4977 6.12784C12.5208 6.09398 12.5505 6.06505 12.5849 6.04272C12.6193 6.0204 12.6578 6.00513 12.6981 5.99779C12.7385 5.99046 12.7799 5.99121 12.82 6L15.27 6.49C15.3896 6.28444 15.5786 6.12825 15.8031 6.04948C16.0275 5.9707 16.2726 5.9745 16.4945 6.06019C16.7164 6.14587 16.9005 6.30784 17.0137 6.51701C17.1269 6.72617 17.1619 6.96885 17.1123 7.20147C17.0627 7.4341 16.9319 7.64143 16.7432 7.78627C16.5545 7.9311 16.3204 8.00394 16.0829 7.99172C15.8453 7.9795 15.6199 7.88301 15.4471 7.71958C15.2743 7.55615 15.1654 7.33648 15.14 7.1L13 6.65L12.35 9.77C13.7252 9.7995 15.0624 10.2267 16.2 11C16.4032 10.805 16.6585 10.6729 16.9351 10.6196C17.2117 10.5664 17.4978 10.5943 17.7589 10.7C18.0199 10.8057 18.2449 10.9847 18.4065 11.2154Z'
			]
		},
		youtube: {
			viewBox: '0 0 512 512',
			label: 'YouTube',
			paths: [
				'M508.64,148.79c0-45-33.1-81.2-74-81.2C379.24,65,322.74,64,265,64H247c-57.6,0-114.2,1-169.6,3.6-40.8,0-73.9,36.4-73.9,81.4C1,184.59-.06,220.19,0,255.79q-.15,53.4,3.4,106.9c0,45,33.1,81.5,73.9,81.5,58.2,2.7,117.9,3.9,178.6,3.8q91.2.3,178.6-3.8c40.9,0,74-36.5,74-81.5,2.4-35.7,3.5-71.3,3.4-107Q512.24,202.29,508.64,148.79ZM207,353.89V157.39l145,98.2Z'
			]
		},
		instagram: {
			viewBox: '0 0 24 24',
			label: 'Instagram',
			paths: [
				'M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 011.772 1.153 4.902 4.902 0 011.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 01-1.153 1.772 4.902 4.902 0 01-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 01-1.772-1.153 4.902 4.902 0 01-1.153-1.772c-.247-.636-.416-1.363-.465-2.427-.047-1.024-.06-1.379-.06-3.808v-.63c0-2.43.013-2.784.06-3.808.049-1.064.218-1.791.465-2.427a4.902 4.902 0 011.153-1.772A4.902 4.902 0 015.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 00-.748-1.15 3.098 3.098 0 00-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 110 10.27 5.135 5.135 0 010-10.27zm0 1.802a3.333 3.333 0 100 6.666 3.333 3.333 0 000-6.666zm5.338-3.205a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z'
			]
		},
		discord: {
			viewBox: '0 0 24 24',
			label: 'Discord',
			paths: [
				'M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0c-.14-.34-.35-.76-.54-1.09c-.01-.02-.04-.03-.07-.03c-1.5.26-2.93.71-4.27 1.33c-.01 0-.02.01-.03.02c-2.72 4.07-3.47 8.03-3.1 11.95c0 .02.01.04.03.05c1.8 1.32 3.53 2.12 5.24 2.65c.03.01.06 0 .07-.02c.4-.55.76-1.13 1.07-1.74c.02-.04 0-.08-.04-.09c-.57-.22-1.11-.48-1.64-.78c-.04-.02-.04-.08-.01-.11c.11-.08.22-.17.33-.25c.02-.02.05-.02.07-.01c3.44 1.57 7.15 1.57 10.55 0c.02-.01.05-.01.07.01c.11.09.22.17.33.26c.04.03.04.09-.01.11c-.52.31-1.07.56-1.64.78c-.04.01-.05.06-.04.09c.32.61.68 1.19 1.07 1.74c.03.01.06.02.09.01c1.72-.53 3.45-1.33 5.25-2.65c.02-.01.03-.03.03-.05c.44-4.53-.73-8.46-3.1-11.95c-.01-.01-.02-.02-.04-.02zM8.52 14.91c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.84 2.12-1.89 2.12zm6.97 0c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.83 2.12-1.89 2.12z'
			]
		}
	};

	// BCMR URIs in the wild use a few common aliases. Map them onto the
	// canonical brand spec so a token with `tg` or `tw` still gets the
	// right logo.
	const URI_ALIASES: Record<string, string> = {
		tg: 'telegram',
		tw: 'twitter',
		gh: 'github',
		yt: 'youtube',
		ig: 'instagram',
		dc: 'discord',
		discordapp: 'discord',
		website: 'web',
		homepage: 'web',
		site: 'web'
	};

	// Generic "link" icon used for BCMR URI keys we don't have a brand
	// mark for (wiki, paper, chat, forum, tiktok, discord, linkedin, …).
	const GENERIC_LINK_ICON: IconSpec = {
		viewBox: '0 0 24 24',
		label: 'Link',
		paths: [
			'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
			'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'
		]
	};

	// Map a BCMR URI key to its icon + a human label. Case-insensitive
	// match. "icon" and "image" are suppressed entirely — the token's
	// hero image already uses them.
	function uriSpec(key: string): IconSpec | null {
		const k = key.toLowerCase();
		if (k === 'icon' || k === 'image') return null;
		const canonical = URI_ALIASES[k] ?? k;
		return URI_ICONS[canonical] ?? { ...GENERIC_LINK_ICON, label: key };
	}

	// Only render URIs whose scheme is in the safelist. Same pattern the
	// previous BCMR section used; prevents `javascript:` / `data:` / `file:`
	// from being rendered as clickable.
	function safeUri(v: string): boolean {
		return /^(https?|ipfs|mailto):/i.test(v);
	}

	const token = $derived(data.token);
	const decimalSupply = $derived(
		humanizeNumericSupply(token.currentSupply, token.decimals)
	);

	// Days since chain genesis — stable across page renders since
	// genesisTime is a fixed past timestamp; we don't need a reactive clock.
	const ageDays = $derived(
		Math.max(0, Math.floor((Date.now() / 1000 - token.genesisTime) / 86_400))
	);
	function formatAge(days: number): string {
		if (days < 1) return 'today';
		if (days === 1) return '1 day ago';
		if (days < 30) return `${days} days ago`;
		const months = Math.floor(days / 30);
		if (months < 12) return `${months} mo ago`;
		const years = Math.floor(days / 365);
		const rem = Math.floor((days % 365) / 30);
		return rem > 0 ? `${years}y ${rem}mo ago` : `${years}y ago`;
	}
	function formatRelative(unixSec: number | null | undefined): string | null {
		if (unixSec == null) return null;
		const diffSec = Math.floor(Date.now() / 1000) - unixSec;
		if (diffSec < 60) return 'just now';
		if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
		if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)}h ago`;
		const days = Math.floor(diffSec / 86_400);
		if (days < 30) return `${days}d ago`;
		const months = Math.floor(days / 30);
		if (months < 12) return `${months}mo ago`;
		return `${Math.floor(days / 365)}y ago`;
	}
	function formatAbsoluteDate(unixSec: number | null | undefined): string | null {
		if (unixSec == null) return null;
		return new Date(unixSec * 1000).toISOString().slice(0, 10);
	}
	const BUCKET_LABEL: Record<'upvoted' | 'downvoted' | 'controversial', string> = {
		upvoted: 'Most upvoted',
		downvoted: 'Most downvoted',
		controversial: 'Most controversial'
	};
	const BUCKET_TONE: Record<'upvoted' | 'downvoted' | 'controversial', string> = {
		upvoted: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
		downvoted: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
		controversial: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
	};
	function fmtUsd(v: number): string {
		if (v >= 1) return `$${v.toFixed(2)}`;
		return `$${v.toFixed(6)}`;
	}

	// Top-5 standings across the three vote-leaderboard buckets, gating
	// the inline badge strip near the page header. Filtered to currentRank
	// ≤ 5 so the strip only fires for honestly-top-tier rankings; the
	// underlying `leaderboardStandings.standings` array still carries the
	// full set for the dedicated "Sentiment standings" card lower down.
	const standings = $derived(
		data.leaderboardStandings.standings.filter(
			(s) => s.currentRank !== null && s.currentRank <= 5
		)
	);
	const showBadges = $derived(
		data.watchlistCount > 0 ||
			data.moverBadges.gainerRank > 0 ||
			data.moverBadges.loserRank > 0 ||
			data.moverBadges.tvlMoverRank > 0 ||
			data.arbitrage.eligible ||
			(data.cauldronTvlSharePct != null && data.cauldronTvlSharePct >= 10) ||
			data.tvlRank != null ||
			standings.length > 0
	);

	// FT UTXO count derived from live_utxo_count − live_nft_count for
	// hybrid (FT+NFT) tokens. Pure-FT and pure-NFT tokens skip the
	// "composition" line entirely; the "FT UTXOs" framing only makes
	// sense when both halves coexist on-chain.
	const ftCount = $derived((token.liveUtxoCount ?? 0) - (token.liveNftCount ?? 0));
	const showHybridComposition = $derived(
		(token.liveNftCount ?? 0) > 0 && ftCount > 0 && token.tokenType === 'FT+NFT'
	);
	const hasExtremes = $derived(
		(data.priceExtremes['24h'].min != null && data.priceExtremes['24h'].max != null) ||
			(data.priceExtremes['7d'].min != null && data.priceExtremes['7d'].max != null) ||
			(data.priceExtremes['30d'].min != null && data.priceExtremes['30d'].max != null)
	);
	const marketCapUSD = $derived.by(() => {
		if (!token.currentSupply || data.priceUSD === 0) return 0;
		// Integer-shift in BigInt space to keep the integer part exact for supplies > 2^53.
		try {
			const base = BigInt(token.currentSupply);
			const divisor = 10n ** BigInt(Math.max(0, Math.min(8, token.decimals)));
			const whole = Number(base / divisor);
			const frac = Number(base % divisor) / Number(divisor);
			return (whole + frac) * data.priceUSD;
		} catch {
			return 0;
		}
	});

	// Report form — closed by default; opens inline on click. No modal, no
	// extra deps. URL is the source of truth elsewhere; here the form is
	// purely local state so it doesn't survive navigation.
	let showReport = $state(false);
	let reportReason = $state<ReportReason>('offensive');
	let reportDetails = $state('');
	let reportEmail = $state('');
	let reportStatus = $state<'idle' | 'submitting' | 'ok' | 'ratelimited' | 'error'>('idle');

	async function submitReport(e: SubmitEvent) {
		e.preventDefault();
		if (reportStatus === 'submitting' || reportStatus === 'ok') return;
		reportStatus = 'submitting';
		try {
			const res = await fetch(`/api/tokens/${token.id}/report`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					reason: reportReason,
					details: reportDetails.trim() || undefined,
					reporter_email: reportEmail.trim() || undefined
				})
			});
			if (res.status === 204) {
				reportStatus = 'ok';
			} else if (res.status === 429) {
				reportStatus = 'ratelimited';
			} else {
				reportStatus = 'error';
			}
		} catch {
			reportStatus = 'error';
		}
	}
</script>

<svelte:head>
	<title>{stripEmoji(token.name) || token.id.slice(0, 10)} — Token Stork</title>
	{#if token.description}
		<meta name="description" content={stripEmoji(token.description).slice(0, 160)} />
	{/if}
</svelte:head>

<main class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<div class="flex items-start gap-4 mb-6">
		<img src={iconHrefFor(token.icon, token.iconClearedHash)} alt={token.name ?? ''} class="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-slate-100 dark:bg-slate-800" />
		<div class="flex-1 min-w-0">
			<h1 class="text-3xl font-bold text-slate-900 dark:text-white truncate flex items-center gap-2">
				<StarButton categoryHex={token.id} size="md" />
				<span class="truncate">
					{stripEmoji(token.name) || '—'}
					{#if token.symbol}<span class="ml-3 text-lg text-slate-500 font-mono font-normal">{stripEmoji(token.symbol)}</span>{/if}
				</span>
			</h1>
			<div class="mt-2 flex items-center gap-3 flex-wrap">
				<VoteButton
					categoryHex={token.id}
					upCount={data.votes.upCount}
					downCount={data.votes.downCount}
					size="md"
				/>
				<span class="px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs font-medium">
					{token.tokenType}
				</span>
				{#if data.crc20}
					<Crc20Badge
						isCanonical={data.crc20.isCanonical}
						symbol={data.crc20.symbol}
						symbolIsHex={data.crc20.symbolIsHex}
						size="sm"
					/>
				{/if}
				{#if token.isVerifiedOnchain}
					<Tooltip>
						<TooltipTrigger class="text-xs text-emerald-600 dark:text-emerald-400 cursor-help">
							✓ Verified on-chain
						</TooltipTrigger>
						<TooltipContent>
							Confirmed on-chain via our local BCHN: this category id appears in a real CashTokens genesis transaction at the genesis block, and current supply / live UTXOs / holders are derived from the indexed UTXO set (not from a third-party indexer or self-reported metadata).
						</TooltipContent>
					</Tooltip>
				{/if}
				{#if token.isFullyBurned}
					<span class="text-xs text-red-600">Fully burned</span>
				{/if}
				{#if token.hasActiveMinting}
					<Tooltip>
						<TooltipTrigger class="text-xs text-amber-600 cursor-help">
							Minting open
						</TooltipTrigger>
						<TooltipContent>
							At least one live UTXO of this category carries the `minting` NFT capability. Whoever holds that UTXO can mint additional NFTs of this category at any time. Supply is not capped at the level shown — treat the supply number as a snapshot rather than the maximum.
						</TooltipContent>
					</Tooltip>
				{/if}
				<FormatCategory category={token.id} />
			</div>
		</div>
	</div>

	{#if token.description}
		<p class="text-slate-600 dark:text-slate-300 mb-6">{stripEmoji(token.description)}</p>
	{/if}

	<!--
		Compact BCMR info bar right under the description. Icon-first row
		for URIs (Web / X / GitHub / Telegram / …) + status pill + tags +
		splitId link. Heavy technical bits (NFT types JSON, extensions
		JSON) stay in the lower "BCMR technical" section so this strip
		stays glanceable.
	-->
	{#if data.bcmr}
		{@const bcmr = data.bcmr}
		{@const uriEntries = bcmr.uris
			? Object.entries(bcmr.uris).filter(([k, v]) => uriSpec(k) !== null && safeUri(v))
			: []}
		{@const hasCompact =
			bcmr.status ||
			bcmr.splitId ||
			uriEntries.length > 0 ||
			(bcmr.tags && bcmr.tags.length > 0)}
		{#if hasCompact}
			<div class="mb-8 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center gap-x-5 gap-y-3">
				{#if uriEntries.length > 0}
					<div class="flex flex-wrap items-center gap-2">
						{#each uriEntries as [key, value] (key)}
							{@const spec = uriSpec(key)}
							{#if spec}
								<a
									href={value}
									target="_blank"
									rel="noopener noreferrer"
									class="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 hover:bg-violet-100 dark:bg-slate-800 dark:hover:bg-violet-900/30 text-slate-600 hover:text-violet-700 dark:text-slate-300 dark:hover:text-violet-300 transition-colors"
									title={`${spec.label}: ${value}`}
									aria-label={spec.label}
								>
									<!--
										fill-rule="evenodd" matters for brand marks whose path
										data encodes an outer body + inner cutouts as separate
										subpaths (Reddit's eyes/mouth, GitHub's octocat). With
										the default nonzero rule those cutouts fill solid in the
										same direction as the body and the icon collapses to a
										silhouette. Mirrors the Footer's social-icon block.
									-->
									<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox={spec.viewBox} fill="currentColor" stroke="currentColor" stroke-width={spec.viewBox === '0 0 24 24' && (key === 'web' || spec.label === 'Link') ? '2' : '0'} stroke-linecap="round" stroke-linejoin="round" fill-rule="evenodd" clip-rule="evenodd" aria-hidden="true">
										{#each spec.paths as d (d)}
											<path {d} fill={key === 'web' || spec.label === 'Link' ? 'none' : 'currentColor'} />
										{/each}
									</svg>
								</a>
							{/if}
						{/each}
					</div>
				{/if}

				{#if bcmr.tags && bcmr.tags.length > 0}
					<div class="flex flex-wrap gap-1.5">
						{#each bcmr.tags as tag (tag)}
							<span class="px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs">
								{tag}
							</span>
						{/each}
					</div>
				{/if}

				{#if bcmr.status}
					<div class="flex items-center gap-1.5 text-xs">
						<span class="text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</span>
						<span class="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium">{bcmr.status}</span>
					</div>
				{/if}

				{#if bcmr.splitId}
					{@const validSplitId = /^[0-9a-f]{64}$/i.test(bcmr.splitId)}
					<div class="flex items-center gap-1.5 text-xs min-w-0">
						<span class="text-slate-500 dark:text-slate-400 uppercase tracking-wider flex-shrink-0">Split from</span>
						{#if validSplitId}
							<a
								href={`/token/${bcmr.splitId.toLowerCase()}`}
								class="font-mono text-violet-600 dark:text-violet-400 hover:underline truncate"
								title={bcmr.splitId}
							>
								{bcmr.splitId.slice(0, 10)}…{bcmr.splitId.slice(-6)}
							</a>
						{:else}
							<span class="font-mono text-slate-500 dark:text-slate-400 truncate" title="Invalid hex splitId — not rendered as link">
								{bcmr.splitId.slice(0, 10)}… <em class="not-italic">(invalid)</em>
							</span>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	{/if}

	<!--
		CRC-20 detail card. Renders only for tokens whose genesis tx
		carries a CRC-20 covenant reveal. Surfaces:
		  - canonical-winner status (won this symbol's per-symbol sort)
		  - raw on-chain symbol / decimals / name (authoritative — note
		    the BCMR-published symbol may differ; both are shown here
		    when they disagree)
		  - genesis provenance (commit_block, reveal_block, fair_genesis_height)
		  - full list of contenders sharing this symbol bucket, with the
		    canonical winner pinned at the top
		See docs/crc20-plan.md for the protocol design.
	-->
	{#if data.crc20}
		{@const crc20 = data.crc20}
		<div class="mb-8 p-5 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/10">
			<div class="flex items-start justify-between gap-4 flex-wrap mb-4">
				<div class="flex items-center gap-3">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						class="w-6 h-6 text-amber-600 dark:text-amber-400"
						aria-hidden="true"
					>
						<path
							fill-rule="evenodd"
							d="M10 1.5l7 3v5c0 4.5-3 8.4-7 9-4-0.6-7-4.5-7-9v-5l7-3zm0 4.2l-3.2 3.2-1.3-1.3-1.4 1.4 2.7 2.7 4.6-4.6-1.4-1.4z"
							clip-rule="evenodd"
						/>
					</svg>
					<div>
						<h2 class="text-lg font-semibold text-slate-900 dark:text-white inline-flex items-center gap-1.5">
							CRC-20 token
							<a
								href="/faq#faq-crc20-vs-bcmr"
								class="inline-flex items-center justify-center w-5 h-5 rounded-full text-slate-400 hover:text-amber-700 dark:hover:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
								title="What's the difference between CRC-20 and BCMR?"
								aria-label="What's the difference between CRC-20 and BCMR?"
							>
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4" aria-hidden="true">
									<path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
								</svg>
							</a>
						</h2>
						<p class="text-xs text-slate-500 dark:text-slate-400">
							On-chain naming claim via covenant in genesis transaction.
							<a href="https://crc20.cash/" target="_blank" rel="noopener noreferrer" class="text-amber-700 dark:text-amber-400 hover:underline">Learn more →</a>
						</p>
					</div>
				</div>
				{#if crc20.isCanonical}
					<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-600 text-white text-xs font-semibold" title={`This category is the canonical winner for "${crc20.symbol}" — the earliest valid genesis under the per-symbol sort.`}>
						🏆 Canonical winner for "{crc20.symbol || '<empty>'}"
					</span>
				{:else}
					<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold" title="This category claims the same symbol but lost the per-symbol canonical sort to an earlier genesis.">
						Non-canonical contender for "{crc20.symbol || '<empty>'}"
					</span>
				{/if}
			</div>

			<dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
				<div>
					<dt class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-0.5">On-chain symbol</dt>
					<dd class="font-mono text-slate-900 dark:text-white break-all">
						{crc20.symbol || '<empty>'}
						{#if crc20.symbolIsHex}
							<span class="ml-2 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400" title="Symbol bytes are not valid UTF-8; rendered as hex.">non-UTF-8</span>
						{/if}
					</dd>
					<dd class="text-xs text-slate-500 dark:text-slate-400 font-mono mt-1">bytes: 0x{crc20.symbolBytesHex || '(empty)'}</dd>
				</div>
				<div>
					<dt class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-0.5">On-chain decimals</dt>
					<dd class="font-mono text-slate-900 dark:text-white">{crc20.decimals}</dd>
				</div>
				<div class="sm:col-span-2">
					<dt class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-0.5">On-chain name</dt>
					<dd class="font-mono text-slate-900 dark:text-white break-all">{crc20.name ?? '<non-UTF-8 bytes>'}</dd>
					{#if token.name && crc20.name && token.name !== crc20.name}
						<dd class="text-xs text-amber-700 dark:text-amber-400 mt-1">
							⚠ BCMR name (<span class="font-mono">{stripEmoji(token.name)}</span>) differs from the on-chain claim.
						</dd>
					{/if}
				</div>
				<div>
					<dt class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-0.5">Genesis provenance</dt>
					<dd class="text-slate-700 dark:text-slate-300 text-xs">
						Commit block <span class="font-mono">{crc20.commitBlock.toLocaleString()}</span><br />
						Reveal block <span class="font-mono">{crc20.revealBlock.toLocaleString()}</span><br />
						Fair genesis height <span class="font-mono">{crc20.fairGenesisHeight.toLocaleString()}</span>
						<span class="text-slate-500 dark:text-slate-500" title="max(commit_block, reveal_block - 20). Drives the per-symbol canonical sort.">ⓘ</span>
					</dd>
				</div>
				<div>
					<dt class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-0.5">Recipient pubkey</dt>
					<dd class="font-mono text-xs text-slate-700 dark:text-slate-300 break-all">{crc20.recipientPubkeyHex.slice(0, 16)}…{crc20.recipientPubkeyHex.slice(-8)}</dd>
				</div>
			</dl>

			{#if crc20.contenders.length > 1}
				<details class="group mt-5 pt-4 border-t border-amber-200 dark:border-amber-900/40">
					<summary class="cursor-pointer flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 list-none select-none">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 20 20"
							fill="currentColor"
							class="w-4 h-4 transition-transform group-open:rotate-90"
							aria-hidden="true"
						>
							<path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" />
						</svg>
						<span>Contenders for "{crc20.symbol || '<empty>'}" ({crc20.contenders.length})</span>
					</summary>
					<ul class="mt-3 space-y-1.5 text-xs">
						{#each crc20.contenders as cont (cont.categoryHex)}
							<li class="flex items-center gap-2">
								{#if cont.isCanonical}
									<span class="px-1.5 py-0.5 rounded bg-amber-600 text-white text-[10px] font-semibold">winner</span>
								{:else}
									<span class="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px]">n.c.</span>
								{/if}
								{#if cont.categoryHex === token.id}
									<span class="font-mono text-slate-700 dark:text-slate-300">{cont.categoryHex.slice(0, 12)}…{cont.categoryHex.slice(-6)}</span>
									<span class="text-amber-700 dark:text-amber-400 font-medium">(this token)</span>
								{:else}
									<a href={`/token/${cont.categoryHex}`} class="font-mono text-violet-600 dark:text-violet-400 hover:underline">
										{cont.categoryHex.slice(0, 12)}…{cont.categoryHex.slice(-6)}
									</a>
								{/if}
								<span class="text-slate-500 dark:text-slate-500 ml-auto">fair height {cont.fairGenesisHeight.toLocaleString()}</span>
							</li>
						{/each}
					</ul>
				</details>
			{/if}
		</div>
	{/if}

	<!--
		Status & sentiment badges. Each pill renders only when its
		signal applies — invisible on most tokens, dense on tokens that
		actually move on multiple axes (top-of-leaderboard meme, big TVL
		share, mover, etc.). Lives between the BCMR compact bar and the
		core stats grid so it doesn't wedge into either.
	-->
	{#if showBadges}
		<div class="mb-6 flex flex-wrap items-center gap-2">
			{#if data.tvlRank != null}
				<a
					href="/?sort=tvl"
					class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-600 text-white text-xs font-semibold hover:bg-cyan-700"
					title={`Ranked #${data.tvlRank} by Cauldron pool TVL across all listed tokens. Other venues (Fex, Tapswap) are not factored in. Click to view the directory sorted by TVL.`}
				>
					🏆 #{data.tvlRank} by Cauldron TVL
				</a>
			{/if}
			{#if data.cauldronTvlSharePct != null && data.cauldronTvlSharePct >= 10}
				<span
					class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-600 text-white text-xs font-semibold"
					title="This token's Cauldron pool TVL is {data.cauldronTvlSharePct.toFixed(1)}% of the entire Cauldron exchange. Concentration this high means the pool is a major part of the AMM's liquidity."
				>
					⚡ {data.cauldronTvlSharePct.toFixed(1)}% of Cauldron TVL
				</span>
			{/if}
			{#each standings as s (s.bucket)}
				<a
					href="/#community-sentiment"
					class={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${BUCKET_TONE[s.bucket]}`}
					title={`Ranked #${s.currentRank} in ${BUCKET_LABEL[s.bucket]} on ${data.leaderboardStandings.latestDay}. Click to view leaderboards.`}
				>
					<span>#{s.currentRank} {BUCKET_LABEL[s.bucket]}</span>
					{#if s.streakDays >= 3}
						<span class="opacity-80" title="{s.streakDays}-day streak in the top 5">🔥{s.streakDays}d</span>
					{/if}
					{#if s.medalGold > 0}
						<span title="{s.medalGold} day{s.medalGold === 1 ? '' : 's'} ranked #1 lifetime">🥇{s.medalGold}</span>
					{:else if s.medalSilver > 0}
						<span title="{s.medalSilver} day{s.medalSilver === 1 ? '' : 's'} ranked top-3 lifetime">🥈{s.medalSilver}</span>
					{:else if s.medalBronze > 0}
						<span title="{s.medalBronze} day{s.medalBronze === 1 ? '' : 's'} ranked top-5 lifetime">🥉{s.medalBronze}</span>
					{/if}
				</a>
			{/each}
			{#if data.moverBadges.gainerRank > 0}
				{@const pct = data.moverBadges.pricePct ?? 0}
				<span
					class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold"
					title="Top {data.moverBadges.gainerRank} of 5 24h gainers on Cauldron"
				>
					📈 #{data.moverBadges.gainerRank} 24h gainer
					{#if pct !== 0}<span class="opacity-80">+{pct.toFixed(1)}%</span>{/if}
				</span>
			{/if}
			{#if data.moverBadges.loserRank > 0}
				{@const pct = data.moverBadges.pricePct ?? 0}
				<span
					class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-xs font-semibold"
					title="Top {data.moverBadges.loserRank} of 5 24h losers on Cauldron"
				>
					📉 #{data.moverBadges.loserRank} 24h loser
					{#if pct !== 0}<span class="opacity-80">{pct.toFixed(1)}%</span>{/if}
				</span>
			{/if}
			{#if data.moverBadges.tvlMoverRank > 0}
				{@const pct = data.moverBadges.tvlPct ?? 0}
				<span
					class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 text-xs font-semibold"
					title="Top {data.moverBadges.tvlMoverRank} of 5 24h TVL movers on Cauldron"
				>
					💧 #{data.moverBadges.tvlMoverRank} TVL mover
					{#if pct !== 0}<span class="opacity-80">{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</span>{/if}
				</span>
			{/if}
			{#if data.arbitrage.eligible}
				<a
					href="/arbitrage"
					class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-300 text-xs font-semibold hover:bg-fuchsia-200 dark:hover:bg-fuchsia-900/50"
					title={`Listed on ${data.arbitrage.venuesPresent} venues — visible on the /arbitrage page${data.arbitrage.rawSpreadPct != null ? ` with a ${data.arbitrage.rawSpreadPct.toFixed(2)}% raw spread` : ''}`}
				>
					⇄ Arbitrage
					{#if data.arbitrage.rawSpreadPct != null}
						<span class="opacity-80">{data.arbitrage.rawSpreadPct.toFixed(2)}%</span>
					{/if}
				</a>
			{/if}
			{#if data.watchlistCount > 0}
				<span
					class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium"
					title="Number of distinct wallets that have added this token to their watchlist"
				>
					⭐ On {data.watchlistCount} watchlist{data.watchlistCount === 1 ? '' : 's'}
				</span>
			{/if}
		</div>
	{/if}

	<!--
		Icon-status banner — only fires when the icon is hidden AND we
		have something concrete to say about why. Keeps the page honest
		about why the placeholder is showing instead of leaving visitors
		guessing whether the issuer didn't ship one.
	-->
	{#if token.iconStatus.status !== 'cleared'}
		{@const tone =
			token.iconStatus.status === 'blocked'
				? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/40 text-red-800 dark:text-red-200'
				: token.iconStatus.status === 'no_uri'
					? 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
					: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/40 text-amber-800 dark:text-amber-200'}
		<div class={`mb-6 px-3 py-2 rounded-lg border text-xs ${tone}`} role="note">
			<span class="font-medium">Icon:</span> {token.iconStatus.label}
		</div>
	{/if}

	<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
			<div class="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Supply</div>
			<div class="text-xl font-mono">{decimalSupply}</div>
		</div>
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
			<div class="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Holders</div>
			<div class="text-xl">{token.holderCount ?? '—'}</div>
		</div>
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
			<div class="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Price (USD)</div>
			<div class="text-xl font-mono">
				{#if data.priceUSD > 0}
					${data.priceUSD >= 1 ? data.priceUSD.toFixed(2) : data.priceUSD.toFixed(6)}
				{:else}
					—
				{/if}
			</div>
		</div>
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
			<div class="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">TVL (USD)</div>
			<div class="text-xl font-mono">
				{data.tvlUSD > 0 ? formatMarketCap(data.tvlUSD.toString()) : '—'}
			</div>
		</div>
		{#if marketCapUSD > 0 && data.tvlUSD >= data.mcapTvlThresholdUSD}
			<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 col-span-2 md:col-span-1">
				<div class="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1" title="Hidden for tokens whose Cauldron TVL is below the average TVL of the top half of listed tokens — caps derived from negligible liquidity would skew rankings.">Market cap</div>
				<div class="text-xl font-mono">{formatMarketCap(marketCapUSD.toString())}</div>
			</div>
		{/if}
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
			<div class="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Genesis block</div>
			<div class="text-xl font-mono">
				<a
					href={`https://explorer.salemkode.com/block/${token.genesisBlock}`}
					target="_blank"
					rel="noopener noreferrer"
					title="View block on SalemKode Explorer"
					class="hover:text-violet-600"
				>
					{token.genesisBlock.toLocaleString()}
				</a>
			</div>
		</div>
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
			<Tooltip>
				<TooltipTrigger class="block text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 cursor-help text-left">
					Live UTXOs
				</TooltipTrigger>
				<TooltipContent>
					Number of currently-unspent on-chain outputs that carry this token category. CashTokens live in transaction outputs (UTXOs) the same way native BCH does — every transfer creates new UTXOs and consumes old ones. A higher count usually means more on-chain activity (frequent transfers, AMM pool slots, NFT instances). Counted by our local BlockBook indexer.
				</TooltipContent>
			</Tooltip>
			<div class="text-xl font-mono">{token.liveUtxoCount ?? '—'}</div>
		</div>
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
			<Tooltip>
				<TooltipTrigger class="block text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 cursor-help text-left">
					Live NFTs
				</TooltipTrigger>
				<TooltipContent>
					Number of unspent NFT outputs of this category. Each NFT in CashTokens is a UTXO with non-empty `commitment` data; transferring an NFT spends the old UTXO and creates a new one with the same commitment. Pure-FT tokens have 0 NFTs.
				</TooltipContent>
			</Tooltip>
			<div class="text-xl font-mono">{token.liveNftCount ?? '—'}</div>
		</div>
	</div>

	<!--
		Extra per-token info that doesn't fit the four-up headline grid:
		token age, holder concentration, FT/NFT split, recent-trade
		proxies, BCMR freshness, public report count, listed-since.
		Each row only renders when its underlying data is meaningful.
	-->
	<section class="mb-8 grid grid-cols-1 md:grid-cols-2 gap-3">
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">Profile</div>
			<dl class="space-y-2 text-sm">
				<div class="flex justify-between gap-3">
					<dt class="text-slate-500 dark:text-slate-400">Age</dt>
					<dd class="font-mono text-slate-900 dark:text-slate-100" title={new Date(token.genesisTime * 1000).toISOString()}>
						{formatAge(ageDays)} <span class="text-slate-500 ml-1">({ageDays.toLocaleString()}d)</span>
					</dd>
				</div>
				{#if token.topHolderSharePct != null}
					<div class="flex justify-between gap-3">
						<dt class="text-slate-500 dark:text-slate-400">Top holder controls</dt>
						<dd class="font-mono {token.topHolderSharePct >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-slate-100'}" title="Largest single holder's balance ÷ current supply">
							{token.topHolderSharePct.toFixed(token.topHolderSharePct >= 10 ? 1 : 2)}%
						</dd>
					</div>
				{/if}
				{#if token.top10HolderSharePct != null && data.holders.length >= 5}
					<div class="flex justify-between gap-3">
						<dt class="text-slate-500 dark:text-slate-400">Top {data.holders.length} hold</dt>
						<dd class="font-mono text-slate-900 dark:text-slate-100">
							{token.top10HolderSharePct.toFixed(token.top10HolderSharePct >= 10 ? 1 : 2)}%
						</dd>
					</div>
				{/if}
				{#if showHybridComposition}
					<div class="flex justify-between gap-3">
						<dt class="text-slate-500 dark:text-slate-400">Composition</dt>
						<dd class="font-mono text-slate-900 dark:text-slate-100">
							{ftCount.toLocaleString()} FT UTXOs · {(token.liveNftCount ?? 0).toLocaleString()} NFTs
						</dd>
					</div>
				{/if}
				{#if data.venueListings.cauldronFirstListedAt}
					<div class="flex justify-between gap-3">
						<dt class="text-slate-500 dark:text-slate-400">Listed on Cauldron</dt>
						<dd class="font-mono text-slate-900 dark:text-slate-100" title={`First seen on Cauldron at ${formatAbsoluteDate(data.venueListings.cauldronFirstListedAt)}`}>
							{formatAbsoluteDate(data.venueListings.cauldronFirstListedAt)}
						</dd>
					</div>
				{/if}
				{#if data.venueListings.fexFirstListedAt}
					<div class="flex justify-between gap-3">
						<dt class="text-slate-500 dark:text-slate-400">Listed on Fex</dt>
						<dd class="font-mono text-slate-900 dark:text-slate-100">
							{formatAbsoluteDate(data.venueListings.fexFirstListedAt)}
						</dd>
					</div>
				{/if}
				{#if token.bcmrFetchedAt}
					<div class="flex justify-between gap-3">
						<dt class="text-slate-500 dark:text-slate-400">BCMR refreshed</dt>
						<dd class="font-mono text-slate-900 dark:text-slate-100" title={new Date(token.bcmrFetchedAt * 1000).toISOString()}>
							{formatRelative(token.bcmrFetchedAt)}
						</dd>
					</div>
				{/if}
				{#if data.reportCount > 0}
					<div class="flex justify-between gap-3">
						<dt class="text-slate-500 dark:text-slate-400">Open reports</dt>
						<dd class="font-mono text-amber-600 dark:text-amber-400" title="Number of unactioned user reports against this token">
							{data.reportCount}
						</dd>
					</div>
				{/if}
			</dl>
		</div>

		{#if hasExtremes || data.recentActivity.recentTradeBuckets > 0}
			<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
				<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">Trading</div>
				<dl class="space-y-2 text-sm">
					{#if data.recentActivity.recentTradeBuckets > 0}
						<div class="flex justify-between gap-3">
							<dt class="text-slate-500 dark:text-slate-400" title="Number of price-history buckets in the last 24h with non-zero TVL delta — proxy for trade activity">24h activity</dt>
							<dd class="font-mono text-slate-900 dark:text-slate-100">
								{data.recentActivity.recentTradeBuckets} active bucket{data.recentActivity.recentTradeBuckets === 1 ? '' : 's'}
								{#if data.recentActivity.recentVolumeUSD > 0}
									<span class="text-slate-500 ml-1">· ~${data.recentActivity.recentVolumeUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
								{/if}
							</dd>
						</div>
					{/if}
					{#each ['24h', '7d', '30d'] as const as windowKey (windowKey)}
						{@const ext = data.priceExtremes[windowKey]}
						{#if ext.min != null && ext.max != null}
							<div class="flex justify-between gap-3">
								<dt class="text-slate-500 dark:text-slate-400">{windowKey} range</dt>
								<dd class="font-mono text-slate-900 dark:text-slate-100">
									{fmtUsd(ext.min)} – {fmtUsd(ext.max)}
								</dd>
							</div>
						{/if}
					{/each}
				</dl>
				<p class="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
					Volume is a lower-bound estimate from |TVL deltas|; price extremes are sampled at our 4 h Cauldron sync cadence.
				</p>
			</div>
		{/if}
	</section>

	{#if data.priceUSD > 0 || data.fexPriceUSD > 0}
		<!--
			Venue comparison. Renders only when at least one AMM has data;
			always shows both columns (Cauldron + Fex) when either fires so
			the visual is symmetrical and the user can spot the absent venue
			at a glance. Spread % shown on the cheaper side — the arb-
			visibility surface the plan calls out.
		-->
		{@const cauldronPx = data.priceUSD}
		{@const fexPx = data.fexPriceUSD}
		{@const bothPresent = cauldronPx > 0 && fexPx > 0}
		{@const spreadPct =
			bothPresent && Math.min(cauldronPx, fexPx) > 0
				? ((Math.max(cauldronPx, fexPx) - Math.min(cauldronPx, fexPx)) /
						Math.min(cauldronPx, fexPx)) *
					100
				: null}
		<section class="mb-8">
			<h2 class="text-xl font-bold text-slate-900 dark:text-white mb-3">AMM venues</h2>
			<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
				<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 {cauldronPx > 0 ? '' : 'opacity-60'}">
					<div class="flex items-center justify-between mb-2">
						<div class="flex items-center gap-2">
							<img src="/cauldron-logo.png" alt="" class="h-5 w-5 rounded-full bg-slate-900 p-0.5" />
							<span class="font-semibold">Cauldron</span>
						</div>
						<div class="flex items-center gap-2">
							{#if bothPresent && spreadPct != null && cauldronPx < fexPx}
								<span class="text-xs px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300" title="Cheaper side — Cauldron's price is {spreadPct.toFixed(2)}% below Fex">−{spreadPct.toFixed(2)}%</span>
							{/if}
							{#if cauldronPx > 0}
								<a
									href={`https://app.cauldron.quest/swap/${token.id}`}
									target="_blank"
									rel="noopener noreferrer"
									class="text-xs text-violet-600 hover:underline"
								>
									View on Cauldron →
								</a>
							{/if}
						</div>
					</div>
					<div class="grid grid-cols-2 gap-2 text-sm">
						<div>
							<div class="text-xs text-slate-500 mb-1">Price</div>
							<div class="font-mono">{cauldronPx > 0 ? (cauldronPx >= 1 ? `$${cauldronPx.toFixed(2)}` : `$${cauldronPx.toFixed(6)}`) : '—'}</div>
						</div>
						<div>
							<div class="text-xs text-slate-500 mb-1">TVL</div>
							<div class="font-mono">{data.tvlUSD > 0 ? formatMarketCap(data.tvlUSD.toString()) : '—'}</div>
						</div>
					</div>
				</div>
				<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 {fexPx > 0 ? '' : 'opacity-60'}">
					<div class="flex items-center justify-between mb-2">
						<div class="flex items-center gap-2">
							<img src="/fex-logo.png" alt="" class="h-5 w-5 rounded-full" />
							<span class="font-semibold">Fex.cash</span>
						</div>
						{#if bothPresent && spreadPct != null && fexPx < cauldronPx}
							<span class="text-xs px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300" title="Cheaper side — Fex's price is {spreadPct.toFixed(2)}% below Cauldron">−{spreadPct.toFixed(2)}%</span>
						{/if}
					</div>
					<div class="grid grid-cols-2 gap-2 text-sm">
						<div>
							<div class="text-xs text-slate-500 mb-1">Price</div>
							<div class="font-mono">{fexPx > 0 ? (fexPx >= 1 ? `$${fexPx.toFixed(2)}` : `$${fexPx.toFixed(6)}`) : '—'}</div>
						</div>
						<div>
							<div class="text-xs text-slate-500 mb-1">TVL</div>
							<div class="font-mono">{data.fexTvlUSD > 0 ? formatMarketCap(data.fexTvlUSD.toString()) : '—'}</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	{/if}

	<!--
		Price + volume chart. Data comes from `token_price_history`,
		bucketed server-side per the active range. URL-driven range
		toggles below the chart let the user widen/narrow without
		page state — `?range=24h|7d|30d|90d|1y|all` is bookmarkable.
	-->
	<section class="mb-8" id="chart">
		<div class="flex items-baseline justify-between mb-3 flex-wrap gap-y-2">
			<h2 class="text-xl font-bold text-slate-900 dark:text-white">
				Price &amp; volume
				<span class="ml-2 text-sm font-normal text-slate-500">Cauldron · {data.priceChart.rangeLabel}</span>
			</h2>
			<div class="flex flex-wrap gap-1 text-xs">
				{#each [
					{ key: '24h', label: '24h' },
					{ key: '7d',  label: '7d' },
					{ key: '30d', label: '30d' },
					{ key: '90d', label: '90d' },
					{ key: '1y',  label: '1y' },
					{ key: 'all', label: 'All' }
				] as r (r.key)}
					{@const active = data.priceChart.range === r.key}
					<a
						href={`?range=${r.key}#chart`}
						class={`px-2.5 py-1 rounded-md font-medium transition-colors ${
							active
								? 'bg-violet-600 text-white'
								: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
						}`}
						aria-current={active ? 'page' : undefined}
					>
						{r.label}
					</a>
				{/each}
			</div>
		</div>
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<PriceChart
				buckets={data.priceChart.buckets}
				decimals={data.token.decimals}
				bchPriceUSD={data.bchPriceUSD}
				rangeLabel={data.priceChart.rangeLabel}
			/>
		</div>
		<p class="mt-2 text-xs text-slate-500 dark:text-slate-400">
			Volume is a lower-bound estimate from |TVL deltas| between consecutive snapshots —
			within-bucket round-trip activity isn't visible at our 4 h sync cadence (10 min fast-pass
			for already-listed tokens). Price is the per-bucket mean.
		</p>
	</section>

	{#if data.tapswapOffers.length > 0}
		<section class="mb-8">
			<div class="flex items-baseline justify-between mb-4">
				<h2 class="text-xl font-bold text-slate-900 dark:text-white">
					Open listings on Tapswap (P2P)
					<span class="ml-2 text-sm font-normal text-slate-500">{data.tapswapOffers.length}</span>
				</h2>
				<a
					href={`https://tapswap.cash/trade/${token.id}`}
					target="_blank"
					rel="noopener noreferrer"
					class="text-sm text-violet-600 hover:underline"
				>
					View on Tapswap →
				</a>
			</div>
			<div class="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
				<table class="w-full text-sm">
					<thead class="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
						<tr>
							<th class="text-left px-4 py-3">Offering</th>
							<th class="text-right px-4 py-3">Asking</th>
							<th class="text-right px-4 py-3">USD</th>
							<th class="text-left px-4 py-3">Maker</th>
						</tr>
					</thead>
					<tbody>
						{#each data.tapswapOffers as offer (offer.id)}
							{@const wantSatsNum = Number(offer.wantSats)}
							{@const wantBch = Number.isFinite(wantSatsNum) ? wantSatsNum / 1e8 : 0}
							{@const wantUsd = wantBch * (data.bchPriceUSD ?? 0)}
							<tr class="border-b border-slate-100 dark:border-slate-800/50">
								<td class="px-4 py-3 font-mono text-xs">
									{#if offer.hasCommitment}
										NFT <span class="text-slate-500">{offer.hasCommitment.slice(0, 16)}…</span>
									{:else if offer.hasAmount}
										{humanizeNumericSupply(offer.hasAmount, token.decimals)}
										{#if token.symbol}<span class="text-slate-500 ml-1">{stripEmoji(token.symbol)}</span>{/if}
									{:else}
										—
									{/if}
								</td>
								<td class="px-4 py-3 text-right font-mono">
									{#if wantBch >= 0.01}
										{wantBch.toFixed(4)} BCH
									{:else}
										{wantSatsNum.toLocaleString()} sats
									{/if}
								</td>
								<td class="px-4 py-3 text-right font-mono text-slate-700 dark:text-slate-300">
									{wantUsd > 0 ? `$${wantUsd < 1 ? wantUsd.toFixed(4) : wantUsd.toFixed(2)}` : '—'}
								</td>
								<td class="px-4 py-3 font-mono text-xs text-slate-500" title="Maker public-key hash (raw bytes; cashaddr rendering deferred)">
									{offer.makerPkhHex.slice(0, 10)}…{offer.makerPkhHex.slice(-6)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="mt-2 text-xs text-slate-500 dark:text-slate-400">
				Listings aggregated from on-chain MPSW OP_RETURNs via our own BCHN —
				not from Tapswap's API. Close events (sale / cancellation) are not
				tracked yet; a stale listing that's already been taken will drop off
				once that enhancement ships.
			</p>
		</section>
	{/if}

	<!--
		BCMR technical bits — NFT types schema + extensions — as collapsible
		JSON dumps. URIs / status / tags / splitId already surface in the
		compact bar near the top; this section is strictly the power-user
		payload and only renders if either dump exists.
	-->
	{#if data.bcmr}
		{@const bcmr = data.bcmr}
		{@const extEntries = bcmr.extensions ? Object.entries(bcmr.extensions) : []}
		{@const nftEntries = bcmr.nftTypes ? Object.entries(bcmr.nftTypes) : []}
		{#if bcmr.nftsDescription || nftEntries.length > 0 || extEntries.length > 0}
			<section class="mb-8">
				<h2 class="text-xl font-bold text-slate-900 dark:text-white mb-4">
					BCMR technical
					<span class="ml-2 text-sm font-normal text-slate-500">NFT schema + extensions</span>
				</h2>
				<div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800">
					{#if bcmr.nftsDescription || nftEntries.length > 0}
						<div class="p-5">
							<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">NFTs</div>
							{#if bcmr.nftsDescription}
								<p class="text-sm text-slate-700 dark:text-slate-300 mb-3">{bcmr.nftsDescription}</p>
							{/if}
							{#if nftEntries.length > 0}
								<details class="text-sm">
									<summary class="cursor-pointer text-violet-600 dark:text-violet-400 hover:underline select-none">
										{nftEntries.length} NFT type{nftEntries.length === 1 ? '' : 's'} defined — show raw
									</summary>
									<pre class="mt-3 p-3 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono overflow-auto max-h-96">{JSON.stringify(bcmr.nftTypes, null, 2)}</pre>
								</details>
							{/if}
						</div>
					{/if}

					{#if extEntries.length > 0}
						<div class="p-5">
							<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Extensions</div>
							<details class="text-sm">
								<summary class="cursor-pointer text-violet-600 dark:text-violet-400 hover:underline select-none">
									{extEntries.length} extension{extEntries.length === 1 ? '' : 's'} — show raw
								</summary>
								<pre class="mt-3 p-3 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono overflow-auto max-h-96">{JSON.stringify(bcmr.extensions, null, 2)}</pre>
							</details>
						</div>
					{/if}
				</div>
			</section>
		{/if}
	{/if}

	{#if data.holders.length > 0}
		{@const supplyBig = (() => {
			try {
				return token.currentSupply ? BigInt(token.currentSupply) : 0n;
			} catch {
				return 0n;
			}
		})()}
		<section class="mb-8">
			<h2 class="text-xl font-bold text-slate-900 dark:text-white mb-4">Top holders</h2>
			<!--
				overflow-x-auto, not overflow-hidden: with the % Supply column
				added the row width can exceed narrow viewports. Hiding overflow
				here would chop the NFT column off-screen on phones; auto lets
				the user scroll horizontally instead. The rounded-xl border still
				clips correctly because the wrapper itself has no inner content
				beyond the table.
			-->
			<div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
				<table class="w-full text-sm">
					<thead class="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
						<tr>
							<th class="text-left px-4 py-3">Address</th>
							<th class="text-right px-4 py-3">Balance</th>
							<th class="text-right px-4 py-3">% Supply</th>
							<th class="text-right px-4 py-3">NFTs</th>
						</tr>
					</thead>
					<tbody>
						{#each data.holders as holder, i (holder.address)}
							{@const pct = (() => {
								if (supplyBig === 0n) return null;
								try {
									const bal = BigInt(holder.balance);
									// Snapshot drift can show bal slightly > supply; we clamp
									// at 100% below. A negative bal would never come from the
									// indexer's NUMERIC(78,0) balances, but if one ever leaks
									// through (corruption, manual repair) we'd rather render a
									// dash than a misleading negative percentage.
									if (bal < 0n) return null;
									return Math.min(100, Number((bal * 1_000_000n) / supplyBig) / 10_000);
								} catch {
									return null;
								}
							})()}
							<tr class="border-b border-slate-100 dark:border-slate-800/50">
								<td class="px-4 py-3 font-mono text-xs truncate max-w-xs">
									<span class="text-slate-400 mr-2">{i + 1}.</span>{holder.address}
								</td>
								<td class="px-4 py-3 text-right font-mono">
									{humanizeNumericSupply(holder.balance, token.decimals)}
								</td>
								<td class="px-4 py-3 text-right font-mono">
									{pct == null ? '—' : `${pct.toFixed(pct >= 10 ? 1 : 2)}%`}
								</td>
								<td class="px-4 py-3 text-right">{holder.nftCount}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	{#if data.bcmr}
		<!--
			Canonical BCMR JSON link. Same Paytaca endpoint the server fetches
			from; placed near the page bottom alongside other power-user / nav
			affordances so visitors who want the raw registry payload can grab
			it without crowding the BCMR compact bar near the top.
		-->
		<div class="mt-8 text-sm text-slate-500 dark:text-slate-400">
			<span class="uppercase tracking-wider text-xs mr-2">BCMR JSON</span>
			<a
				href={`https://bcmr.paytaca.com/api/tokens/${token.id}`}
				target="_blank"
				rel="noopener noreferrer"
				class="font-mono text-violet-600 dark:text-violet-400 hover:underline"
				title="Open the raw BCMR JSON from the Paytaca registry"
			>
				bcmr.paytaca.com ↗
			</a>
		</div>
	{/if}

	<div class="flex items-center justify-between text-sm mt-8 pt-6 border-t border-slate-100 dark:border-slate-800">
		<a href="/" class="text-violet-600 hover:underline">← All tokens</a>
		{#if !showReport && reportStatus !== 'ok'}
			<button
				type="button"
				onclick={() => (showReport = true)}
				class="text-xs text-slate-500 hover:text-violet-600 dark:text-slate-400 dark:hover:text-violet-400"
			>
				Report this token
			</button>
		{/if}
	</div>

	{#if showReport || reportStatus === 'ok'}
		<section
			class="mt-6 p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30"
			aria-label="Report this token"
		>
			{#if reportStatus === 'ok'}
				<h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-2">
					Thanks — we'll review it.
				</h2>
				<p class="text-sm text-slate-600 dark:text-slate-400">
					Your report has been recorded. The operator will triage it shortly.
				</p>
			{:else}
				<h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-1">
					Report this token
				</h2>
				<p class="text-xs text-slate-500 dark:text-slate-400 mb-4">
					Flag content you believe violates good-faith use of the directory.
					Your report is anonymous by default; leave an email only if you'd
					like a follow-up.
				</p>
				<form onsubmit={submitReport} class="space-y-3">
					<div>
						<label for="report-reason" class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
							Reason
						</label>
						<select
							id="report-reason"
							bind:value={reportReason}
							disabled={reportStatus === 'submitting'}
							class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
						>
							{#each REPORT_REASONS as r (r)}
								<option value={r}>{REPORT_REASON_LABELS[r]}</option>
							{/each}
						</select>
					</div>
					<div>
						<label for="report-details" class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
							Details <span class="text-slate-400 font-normal">(optional)</span>
						</label>
						<textarea
							id="report-details"
							bind:value={reportDetails}
							disabled={reportStatus === 'submitting'}
							maxlength={2000}
							rows={4}
							placeholder="Why is this token problematic? Any context you can share helps us triage."
							class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y"
						></textarea>
					</div>
					<div>
						<label for="report-email" class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
							Your email <span class="text-slate-400 font-normal">(optional; for follow-up only)</span>
						</label>
						<input
							id="report-email"
							type="email"
							bind:value={reportEmail}
							disabled={reportStatus === 'submitting'}
							maxlength={200}
							placeholder="you@example.com"
							class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
						/>
					</div>
					{#if reportStatus === 'ratelimited'}
						<p class="text-sm text-amber-600 dark:text-amber-400">
							You've submitted several reports recently. Please wait a bit before sending another.
						</p>
					{:else if reportStatus === 'error'}
						<p class="text-sm text-red-600 dark:text-red-400">
							Couldn't submit right now. Please try again in a moment.
						</p>
					{/if}
					<div class="flex items-center gap-3 pt-1">
						<button
							type="submit"
							disabled={reportStatus === 'submitting'}
							class="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{reportStatus === 'submitting' ? 'Sending…' : 'Submit report'}
						</button>
						<button
							type="button"
							onclick={() => {
								showReport = false;
								reportStatus = 'idle';
							}}
							disabled={reportStatus === 'submitting'}
							class="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 disabled:opacity-50"
						>
							Cancel
						</button>
					</div>
				</form>
			{/if}
		</section>
	{/if}
</main>
