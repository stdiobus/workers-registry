/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Work Target Insight Function.
 * Contact: raman@worktif.com
 *
 * This file is part of the stdio bus protocol reference implementation:
 *   stdio_bus_kernel_workers (target: <target_stdio_bus_kernel_workers>).
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * NDJSON (Newline-Delimited JSON) stream handler for the Registry Launcher.
 *
 * Handles buffering and parsing of NDJSON messages from stdin and writing
 * NDJSON messages to stdout. Supports partial reads across multiple chunks.
 *
 * @module stream/ndjson-handler
 */

import { Writable } from 'node:stream';

/**
 * Callback type for parsed messages.
 */
export type MessageCallback = (message: object) => void;

/**
 * Callback type for parse errors.
 */
export type ErrorCallback = (error: Error, line: string) => void;

/**
 * Interface for NDJSON stream handling.
 */
export interface INDJSONHandler {
  /**
   * Register a callback for parsed messages.
   */
  onMessage(callback: MessageCallback): void;

  /**
   * Register a callback for parse errors.
   */
  onError(callback: ErrorCallback): void;

  /**
   * Write a message to the output stream.
   * @returns true if write was successful, false if stream is not writable
   */
  write(message: object): boolean;

  /**
   * Process incoming data chunk (call from stdin 'data' event).
   */
  processChunk(chunk: Buffer): void;
}

/**
 * Log an error message to stderr with ISO 8601 timestamp.
 * @param message - Error message to log
 */
function logError(message: string): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [ERROR] [ndjson] ${message}`);
}

/**
 * NDJSON stream handler implementation.
 *
 * This class handles:
 * - Buffering incoming data until complete newline-delimited messages are received
 * - Handling partial JSON messages that span multiple read operations
 * - Appending newline characters after each JSON message when writing
 * - Splitting on newline boundaries when reading
 * - Logging errors and skipping malformed lines
 */
export class NDJSONHandler implements INDJSONHandler {
  /** Buffer for accumulating partial data */
  private buffer: string = '';

  /** Output stream for writing messages */
  private readonly output: Writable;

  /** Registered message callback */
  private messageCallback: MessageCallback | null = null;

  /** Registered error callback */
  private errorCallback: ErrorCallback | null = null;

  /**
   * Create a new NDJSONHandler.
   * @param output - Writable stream for output (typically process.stdout)
   */
  constructor(output: Writable) {
    this.output = output;
  }

  /**
   * Register a callback for parsed messages.
   * Only one callback can be registered at a time.
   *
   * @param callback - Function to call with each parsed message
   */
  onMessage(callback: MessageCallback): void {
    this.messageCallback = callback;
  }

  /**
   * Register a callback for parse errors.
   * Only one callback can be registered at a time.
   *
   * @param callback - Function to call with parse errors
   */
  onError(callback: ErrorCallback): void {
    this.errorCallback = callback;
  }

  /**
   * Write a message to the output stream.
   *
   * Serializes the message as JSON and appends a newline character.
   *
   *  @param message - Object to serialize and write
   * @returns true if write was successful, false if stream is not writable
   */
  write(message: object): boolean {
    if (!this.output.writable) {
      return false;
    }

    try {
      const json = JSON.stringify(message);
      this.output.write(json + '\n');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Process incoming data chunk.
   *
   * Buffers data and emits complete messages when newline boundaries are found.
   * Handles partial messages that span multiple chunks.
   *
   * @param chunk - Buffer containing incoming data
   */
  processChunk(chunk: Buffer): void {
    // Append chunk to buffer
    this.buffer += chunk.toString('utf-8');

    // Process complete lines
    this.processBuffer();
  }

  /**
   * Process the internal buffer, extracting and parsing complete lines.
   *
   * Splits on newline boundaries and parses each complete line as JSON.
   * Incomplete lines remain in the buffer for the next chunk.
   */
  private processBuffer(): void {
    let newlineIndex: number;

    // Process all complete lines in the buffer
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      // Extract the line (without the newline)
      const line = this.buffer.slice(0, newlineIndex);

      // Remove the processed line and newline from buffer
      this.buffer = this.buffer.slice(newlineIndex + 1);

      // Skip empty lines
      if (line.trim().length === 0) {
        continue;
      }

      // Parse and emit the message
      this.parseLine(line);
    }
  }

  /**
   * Parse a single line as JSON and emit the message.
   *
   * If parsing fails, logs the error and invokes the error callback.
   * Malformed lines are skipped.
   *
   * @param line - Line to parse as JSON
   */
  private parseLine(line: string): void {
    try {
      const message = JSON.parse(line);

      // Ensure the parsed value is an object (not a primitive)
      if (message === null || typeof message !== 'object') {
        const error = new Error('Parsed JSON is not an object');
        logError(`Malformed NDJSON line (not an object): ${this.truncateLine(line)}`);
        this.errorCallback?.(error, line);
        return;
      }

      // Emit the parsed message
      this.messageCallback?.(message);
    } catch (error) {
      // Log the error and skip the malformed line
      logError(`Failed to parse NDJSON line: ${this.truncateLine(line)}`);
      this.errorCallback?.(error as Error, line);
    }
  }

  /**
   * Truncate a line for logging purposes.
   * @param line - Line to truncate
   * @param maxLength - Maximum length (default: 100)
   * @returns Truncated line with ellipsis if needed
   */
  private truncateLine(line: string, maxLength: number = 100): string {
    if (line.length <= maxLength) {
      return line;
    }
    return line.slice(0, maxLength) + '...';
  }
}
