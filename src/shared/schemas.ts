import { z } from 'zod';

export const cityConfigSchema = z.object({
  cityKey: z.string().min(1),
  displayName: z.string().min(1),
  seriesSlug: z.string().min(1),
  airportCode: z.string().nullable(),
  timezone: z.string().nullable(),
  enabled: z.boolean(),
  resolutionSourceOverride: z.string().nullable().optional(),
});

export const cityConfigArraySchema = z.array(cityConfigSchema);
