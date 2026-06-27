<script lang="ts">
	export let data: {
		entries: Array<{ date: string; time: string; path: string }>;
	};
</script>

<svelte:head>
	<title>Stork Sightings Archive — TokenStork</title>
</svelte:head>

<div class="archive">
	<h1>⬢ Stork Sightings — Archive</h1>
	<p class="sub">Past editions of the daily BCH token briefing.</p>

	{#if data.entries.length > 0}
		<ul class="entries">
			{#each data.entries as entry}
				<li>
					<a href="/briefing/archive/{entry.path}">
						<span class="date">{entry.date}</span>
						<span class="time">{entry.time} UTC</span>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">No archived editions yet. The first daily briefing runs at 11:00 UTC.</p>
	{/if}

	<p class="back">
		<a href="/briefing">← Back to today's briefing</a>
	</p>
</div>

<style>
	.archive {
		max-width: 620px;
		margin: 60px auto;
		padding: 20px;
	}
	.archive h1 {
		font-family: Georgia, 'Times New Roman', serif;
		font-size: 24px;
		color: #0f766e;
		margin: 0 0 8px;
	}
	.sub {
		font-size: 14px;
		color: #64748b;
		margin: 0 0 32px;
	}
	.entries {
		list-style: none;
		padding: 0;
	}
	.entries li {
		padding: 10px 0;
		border-bottom: 1px solid #f1f5f9;
	}
	.entries a {
		display: flex;
		justify-content: space-between;
		align-items: center;
		text-decoration: none;
		color: #1e293b;
		font-size: 15px;
	}
	.entries a:hover {
		color: #0f766e;
	}
	.date {
		font-weight: 600;
	}
	.time {
		font-size: 13px;
		color: #94a3b8;
	}
	.empty {
		font-size: 14px;
		color: #94a3b8;
	}
	.back {
		margin-top: 32px;
		font-size: 13px;
	}
	.back a {
		color: #0f766e;
		text-decoration: none;
	}
	.back a:hover {
		text-decoration: underline;
	}
</style>
