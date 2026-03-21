import { create } from 'zustand';

interface StudioState {
  selectedTrackId: string | null;
  selectedSectionId: string | null;
  setSelectedTrack: (id: string | null) => void;
  setSelectedSection: (id: string | null) => void;
}

export const useStudioStore = create<StudioState>((set) => ({
  selectedTrackId: null,
  selectedSectionId: null,
  setSelectedTrack: (id) => set({ selectedTrackId: id }),
  setSelectedSection: (id) => set({ selectedSectionId: id }),
}));
