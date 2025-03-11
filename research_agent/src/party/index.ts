/**
 * This is the main entry point for the PartyKit server.
 * It exports the server implementations for the different parties.
 */

import { MainServer } from "./main";
import { AnalysisServer } from "./analysis";

// Export the default server
export default MainServer;
export { AnalysisServer }; 