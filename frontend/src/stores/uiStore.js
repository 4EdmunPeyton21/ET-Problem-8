import { create } from 'zustand';

export const useUIStore = create((set) => ({
  // Ingestion State
  ingestionFilter: 'all',
  setIngestionFilter: (filter) => set({ ingestionFilter: filter }),

  // Upload metadata for jobs started this session (live status/progress lives in Query cache, keyed by jobId)
  ingestionJobs: [],
  addIngestionJob: (job) => set((state) => ({ ingestionJobs: [job, ...state.ingestionJobs] })),
  
  // Equipment State
  equipmentTypeFilter: null,
  selectedEquipmentId: null,
  setEquipmentTypeFilter: (type) => set({ equipmentTypeFilter: type }),
  selectEquipment: (id) => set({ selectedEquipmentId: id }),
  
  // RCA State
  rcaHistory: [],
  addRCAResult: (result) => set((state) => ({
    rcaHistory: [result, ...state.rcaHistory]
  })),
  
  // UI State
  sidebarOpen: true, // desktop: expanded vs icon-rail
  mobileNavOpen: false, // mobile: off-canvas drawer, closed by default
  activeToast: null,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  toggleMobileNav: () => set((state) => ({ mobileNavOpen: !state.mobileNavOpen })),
  closeMobileNav: () => set({ mobileNavOpen: false }),
  addToast: (type, message) => {
    set({ activeToast: { type, message } });
    setTimeout(() => {
      set({ activeToast: null });
    }, 5000);
  },
  clearToast: () => set({ activeToast: null }),
}));
