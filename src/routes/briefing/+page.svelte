<script lang="ts">
	export let data: {
		html: string | null;
		hasBriefing: boolean;
	};

	const { html, hasBriefing } = data;
</script>

<svelte:head>
	<title>Stork Sightings — TokenStork</title>
	<meta name="description" content="Daily BCH token briefing from the TokenStork directory. What the stork spotted today." />
</svelte:head>

{#if html}
	{@html html}
{:else}
	<div class="empty-state">
		<h1>⬢ Stork Sightings</h1>
		<p>No briefing yet. The stork is out gathering data — check back later today.</p>
		<p class="sub">The daily briefing runs at 11:00 UTC. It surfaces market movers, new tokens, holder shifts, BCMR changes, and ecosystem health.</p>
	</div>
{/if}

<style>
	.empty-state {
		max-width: 600px;
		margin: 80px auto;
		text-align: center;
		padding: 40px 20px;
	}
	.empty-state h1 {
		font-family: Georgia, 'Times New Roman', serif;
		font-size: 28px;
		color: #0f766e;
		margin: 0 0 16px;
	}
	.empty-state p {
		font-size: 15px;
		color: #64748b;
		line-height: 1.6;
		margin: 0 0 8px;
	}
	.empty-state .sub {
		font-size: 13px;
		color: #94a3b8;
	}
</style>
