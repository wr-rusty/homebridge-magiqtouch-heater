import { type RemoteStatus } from './models.js';
/**
 * A predicate that decides whether an echoed status confirms a command.
 * The websocket layer keeps reading echoes until one of these returns true.
 */
export type Checker = (status: RemoteStatus) => boolean;
export declare const expectSystemOn: (on: boolean) => Checker;
export declare const expectMode: (mode: RemoteStatus["runningMode"]) => Checker;
export declare const expectHeaterSetTemp: (temp: number) => Checker;
export declare const expectHeaterFanSpeed: (speed: number) => Checker;
/** Combine several checkers; all must pass. */
export declare const all: (...checkers: Checker[]) => Checker;
