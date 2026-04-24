// shadcn-svelte convention: re-export the pieces under simple names. Also
// aliases the Root / Trigger / Content / Provider to `Tooltip.*` so you
// can either destructure or namespace-import.

import Root from './tooltip.svelte';
import Trigger from './tooltip-trigger.svelte';
import Content from './tooltip-content.svelte';
import Provider from './tooltip-provider.svelte';

export { Root, Trigger, Content, Provider };
export { Root as Tooltip, Trigger as TooltipTrigger, Content as TooltipContent, Provider as TooltipProvider };
