import type { MediaBriefV1 } from './types';

function compact(value: string | null | undefined, max = 240): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function buildConceptualMediaPrompt(brief: MediaBriefV1): string {
  const constraints = (brief.factualConstraints ?? [])
    .map((item) => compact(item, 180))
    .filter(Boolean)
    .slice(0, 8);
  const style = brief.stylePreset === 'yeosonam_campaign'
    ? 'premium Korean travel brand campaign photography, restrained luxury, generous negative space'
    : brief.stylePreset === 'yeosonam_information'
      ? 'clear editorial travel-guide photography, useful context, calm composition'
      : 'high-end Korean travel magazine editorial photography, natural light, realistic scale and colors';

  return [
    style,
    `Conceptual subject: ${compact(brief.subject)}.`,
    brief.destination ? `Destination context: ${compact(brief.destination, 100)}.` : '',
    constraints.length > 0 ? `Creative constraints: ${constraints.join('; ')}.` : '',
    'Horizontal landscape composition with the key subject inside the central 60 percent and generous clean edges, remaining useful after 16:9, 1:1, and 4:5 crops.',
    'This is an illustrative mood image, never documentary proof of a hotel, room, meal, flight, attraction, or current local condition.',
    'Do not invent or closely imitate a recognizable hotel, room, aircraft cabin, restaurant, attraction, or landmark.',
    'No collage, no advertisement layout, no text, no letters, no numbers, no logo, no watermark, no readable signs.',
    'No identifiable person, no distorted hands, no unsafe activity, no exaggerated saturation.',
  ].filter(Boolean).join(' ');
}
