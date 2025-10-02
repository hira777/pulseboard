import type { z } from 'zod'

import {
  dateRangeSchema,
  isoDateTimeSchema,
  listAvailabilityInputSchema,
  listAvailabilityResultSchema,
  slotSchema,
  wantedEquipmentSchema,
} from './schema'

export type ISODateTime = z.infer<typeof isoDateTimeSchema>

export type DateRange = z.infer<typeof dateRangeSchema>

export type WantedEquipment = z.infer<typeof wantedEquipmentSchema>

export type Slot = z.infer<typeof slotSchema>

export type ListAvailabilityInput = z.infer<typeof listAvailabilityInputSchema>

export type ListAvailabilityResult = z.infer<typeof listAvailabilityResultSchema>
