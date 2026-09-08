import PipelineMain from './components/PipelineMain';

export const PIPELINE_PLUGIN = {
  id: 'pipeline',
  name: 'Universal Pipeline & Kanban',
  version: '1.0.0',
  description: 'Manajemen workflow & pipeline fleksibel (Penjualan, Produktivitas, Produksi, Rekrutmen) dengan Kanban board interaktif.',
  author: 'ShapeUp CRM Team',
  category: 'workflow',
  icon: '📊',
  component: PipelineMain,
};

export default PipelineMain;
export * from './types';
export * from './helpers/kanbanUtils';
export * from './helpers/pipelineApi';
