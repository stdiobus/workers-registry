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
 * Content Mapper
 *
 * Maps MCP tool call results to ACP ToolCallContent format.
 * Handles conversion between MCP content types (TextContent, ImageContent, EmbeddedResource)
 * and ACP ToolCallContent types (Content, Diff, Terminal).
 *
 * Also provides resource_link resolution for ACP prompts.
 *
 * @module acp/content-mapper
 */

import type {
  ContentBlock,
  EmbeddedResource as ACPEmbeddedResource,
  ImageContent as ACPImageContent,
  TextContent as ACPTextContent,
  ToolCallContent,
} from '@agentclientprotocol/sdk';
import type {
  MCPContent,
  MCPEmbeddedResource,
  MCPImageContent,
  MCPResourceContents,
  MCPTextContent,
} from '../mcp/types.js';

/**
 * Maps a single MCP content item to an ACP ContentBlock.
 *
 * MCP content types:
 * - TextContent: { type: 'text', text: string }
 * - ImageContent: { type: 'image', data: string, mimeType: string }
 * - EmbeddedResource: { type: 'resource', resource: { uri, mimeType?, text?, blob? } }
 *
 * ACP ContentBlock types:
 * - TextContent: { type: 'text', text: string }
 * - ImageContent: { type: 'image', data: string, mimeType: string }
 * - EmbeddedResource: { type: 'resource', resource: TextResourceContents | BlobResourceContents }
 *
 * @param mcpContent - The MCP content item to convert
 * @returns The corresponding ACP ContentBlock
 */
export function mapMCPContentToACPContentBlock(mcpContent: MCPContent): ContentBlock {
  switch (mcpContent.type) {
    case 'text':
      return mapTextContent(mcpContent);
    case 'image':
      return mapImageContent(mcpContent);
    case 'resource':
      return mapEmbeddedResource(mcpContent);
    default:
      // Handle unknown content types by converting to text
      return {
        type: 'text',
        text: JSON.stringify(mcpContent),
      };
  }
}

/**
 * Maps MCP TextContent to ACP TextContent.
 *
 * @param mcpText - The MCP text content
 * @returns The ACP text content block
 */
function mapTextContent(mcpText: MCPTextContent): ContentBlock {
  const result: ACPTextContent & { type: 'text' } = {
    type: 'text',
    text: mcpText.text,
  };
  return result;
}

/**
 * Maps MCP ImageContent to ACP ImageContent.
 *
 * @param mcpImage - The MCP image content
 * @returns The ACP image content block
 */
function mapImageContent(mcpImage: MCPImageContent): ContentBlock {
  const result: ACPImageContent & { type: 'image' } = {
    type: 'image',
    data: mcpImage.data,
    mimeType: mcpImage.mimeType,
  };
  return result;
}

/**
 * Maps MCP EmbeddedResource to ACP EmbeddedResource.
 *
 * MCP EmbeddedResource has:
 * - resource.uri: string
 * - resource.mimeType?: string
 * - resource.text?: string (for text resources)
 * - resource.blob?: string (for binary resources)
 *
 * ACP EmbeddedResource expects:
 * - resource: TextResourceContents | BlobResourceContents
 *   - TextResourceContents: { uri, mimeType?, text }
 *   - BlobResourceContents: { uri, mimeType?, blob }
 *
 * @param mcpResource - The MCP embedded resource
 * @returns The ACP embedded resource content block
 */
function mapEmbeddedResource(mcpResource: MCPEmbeddedResource): ContentBlock {
  const { resource } = mcpResource;

  // Determine if this is a text or blob resource
  if (resource.text !== undefined) {
    // Text resource
    const result: ACPEmbeddedResource & { type: 'resource' } = {
      type: 'resource',
      resource: {
        uri: resource.uri,
        mimeType: resource.mimeType,
        text: resource.text,
      },
    };
    return result;
  } else if (resource.blob !== undefined) {
    // Blob resource
    const result: ACPEmbeddedResource & { type: 'resource' } = {
      type: 'resource',
      resource: {
        uri: resource.uri,
        mimeType: resource.mimeType,
        blob: resource.blob,
      },
    };
    return result;
  } else {
    // Resource without content - create empty text resource
    const result: ACPEmbeddedResource & { type: 'resource' } = {
      type: 'resource',
      resource: {
        uri: resource.uri,
        mimeType: resource.mimeType,
        text: '',
      },
    };
    return result;
  }
}

/**
 * Maps an array of MCP content items to ACP ToolCallContent array.
 *
 * Each MCP content item is wrapped in an ACP Content structure with type: 'content'.
 *
 * @param mcpContents - Array of MCP content items
 * @returns Array of ACP ToolCallContent items
 */
export function mapMCPResultToACPToolCallContent(mcpContents: MCPContent[]): ToolCallContent[] {
  return mcpContents.map((mcpContent) => {
    const contentBlock = mapMCPContentToACPContentBlock(mcpContent);
    // Wrap in ACP Content structure with type: 'content'
    return {
      type: 'content' as const,
      content: contentBlock,
    };
  });
}

/**
 * Creates an error ToolCallContent from an error message.
 *
 * Used when MCP tool execution fails (isError: true) to create
 * appropriate error content for the ACP client.
 *
 * @param errorMessage - The error message to display
 * @returns A ToolCallContent array with the error message
 */
export function createErrorToolCallContent(errorMessage: string): ToolCallContent[] {
  return [
    {
      type: 'content' as const,
      content: {
        type: 'text',
        text: `Error: ${errorMessage}`,
      },
    },
  ];
}

/**
 * Maps MCP tool call result to ACP ToolCallContent array.
 *
 * Handles both successful results and error results.
 * For errors, creates appropriate error content.
 *
 * @param content - Array of MCP content items from tool result
 * @param isError - Whether the tool execution resulted in an error
 * @returns Array of ACP ToolCallContent items
 */
export function mapToolResultToACPContent(
  content: MCPContent[],
  isError: boolean = false,
): ToolCallContent[] {
  if (isError && content.length > 0) {
    // For error results, extract text content as error message
    const errorText = content
      .filter((c): c is MCPTextContent => c.type === 'text')
      .map((c) => c.text)
      .join('\n');

    if (errorText) {
      return createErrorToolCallContent(errorText);
    }
  }

  // Map all content items to ACP format
  return mapMCPResultToACPToolCallContent(content);
}


/**
 * Represents a resource_link from an ACP ContentBlock.
 */
export interface ResourceLink {
  type: 'resource_link';
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
}

/**
 * Type guard to check if a ContentBlock is a resource_link.
 *
 * @param block - The content block to check
 * @returns True if the block is a resource_link
 */
export function isResourceLink(block: ContentBlock): block is ResourceLink {
  return block.type === 'resource_link' && 'uri' in block;
}

/**
 * Maps MCP resource contents to an ACP EmbeddedResource ContentBlock.
 *
 * Converts the result of readResource() to an ACP-compatible format.
 *
 * @param contents - The MCP resource contents from readResource()
 * @returns The ACP embedded resource content block
 */
export function mapMCPResourceContentsToACPContentBlock(contents: MCPResourceContents): ContentBlock {
  if ('text' in contents) {
    // Text resource
    const result: ACPEmbeddedResource & { type: 'resource' } = {
      type: 'resource',
      resource: {
        uri: contents.uri,
        mimeType: contents.mimeType,
        text: contents.text,
      },
    };
    return result;
  }

  // Blob resource (the only other option in the union type)
  const result: ACPEmbeddedResource & { type: 'resource' } = {
    type: 'resource',
    resource: {
      uri: contents.uri,
      mimeType: contents.mimeType,
      blob: contents.blob,
    },
  };
  return result;
}

/**
 * Extracts the URI from a resource_link ContentBlock.
 *
 * @param block - The resource_link content block
 * @returns The URI string or null if not a valid resource_link
 */
export function extractResourceLinkUri(block: ContentBlock): string | null {
  if (isResourceLink(block)) {
    return block.uri;
  }
  return null;
}
