export {
  resolveProcessLaunch as applyBashProcessWrappers,
  type ProcessWrapper as BashProcessWrapper,
  type ProcessLaunchContext as BashProcessWrapperContext,
  clearProcessWrappers as clearBashProcessWrappers,
  listProcessWrappers as listBashProcessWrappers,
  registerProcessWrapper as registerBashProcessWrapper,
} from '../shared/processLauncher.js';
