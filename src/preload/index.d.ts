import type { AiEnergyApi } from '../shared/ipc'

declare global {
  interface Window {
    aiEnergy?: AiEnergyApi
  }
}

export {}
