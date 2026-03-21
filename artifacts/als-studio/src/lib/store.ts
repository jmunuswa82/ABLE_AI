import { create } from 'zustand';

interface StudioState {
  selectedTrackId: string | null;
  selectedSectionId: string | null;
  locateAtBeat: number | null;
  locateActionId: string | null;
  setSelectedTrack: (id: string | null) => void;
  setSelectedSection: (id: string | null) => void;
  setLocateAtBeat: (beat: number | null, actionId?: string | null) => void;
}

export const useStudioStore = create<StudioState>((set) => ({
  selectedTrackId: null,
  selectedSectionId: null,
  locateAtBeat: null,
  locateActionId: null,
  setSelectedTrack: (id) => set({ selectedTrackId: id }),
  setSelectedSection: (id) => set({ selectedSectionId: id }),
  setLocateAtBeat: (beat, actionId = null) => set({ locateAtBeat: beat, locateActionId: actionId }),
}));
