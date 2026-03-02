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
 * Content Mapper Tests
 *
 * Tests for mapping MCP content to ACP ToolCallContent.
 */
import {
  createErrorToolCallContent,
  extractResourceLinkUri,
  isResourceLink,
  mapMCPContentToACPContentBlock,
  mapMCPResourceContentsToACPContentBlock,
  mapMCPResultToACPToolCallContent,
  mapToolResultToACPContent,
} from './content-mapper.js';
import type {
  MCPContent,
  MCPEmbeddedResource,
  MCPImageContent,
  MCPResourceContents,
  MCPTextContent,
} from '../mcp/types.js';
import type { ContentBlock } from '@agentclientprotocol/sdk';

describe('mapMCPContentToACPContentBlock', () => {
  describe('TextContent mapping', () => {
    it('should map MCP TextContent to ACP text ContentBlock', () => {
      const mcpText: MCPTextContent = {
        type: 'text',
        text: 'Hello, world!',
      };

      const result = mapMCPContentToACPContentBlock(mcpText);

      expect(result).toEqual({
        type: 'text',
        text: 'Hello, world!',
      });
    });

    it('should handle empty text', () => {
      const mcpText: MCPTextContent = {
        type: 'text',
        text: '',
      };

      const result = mapMCPContentToACPContentBlock(mcpText);

      expect(result).toEqual({
        type: 'text',
        text: '',
      });
    });

    it('should handle text with special characters', () => {
      const mcpText: MCPTextContent = {
        type: 'text',
        text: 'Line 1\nLine 2\tTabbed\r\nWindows line',
      };

      const result = mapMCPContentToACPContentBlock(mcpText);

      expect(result).toEqual({
        type: 'text',
        text: 'Line 1\nLine 2\tTabbed\r\nWindows line',
      });
    });
  });

  describe('ImageContent mapping', () => {
    it('should map MCP ImageContent to ACP image ContentBlock', () => {
      const mcpImage: MCPImageContent = {
        type: 'image',
        data: 'base64encodeddata==',
        mimeType: 'image/png',
      };

      const result = mapMCPContentToACPContentBlock(mcpImage);

      expect(result).toEqual({
        type: 'image',
        data: 'base64encodeddata==',
        mimeType: 'image/png',
      });
    });

    it('should handle different image mime types', () => {
      const mcpImage: MCPImageContent = {
        type: 'image',
        data: 'jpegdata==',
        mimeType: 'image/jpeg',
      };

      const result = mapMCPContentToACPContentBlock(mcpImage);

      expect(result).toEqual({
        type: 'image',
        data: 'jpegdata==',
        mimeType: 'image/jpeg',
      });
    });
  });

  describe('EmbeddedResource mapping', () => {
    it('should map MCP text resource to ACP resource ContentBlock', () => {
      const mcpResource: MCPEmbeddedResource = {
        type: 'resource',
        resource: {
          uri: 'file:///path/to/file.txt',
          mimeType: 'text/plain',
          text: 'File contents here',
        },
      };

      const result = mapMCPContentToACPContentBlock(mcpResource);

      expect(result).toEqual({
        type: 'resource',
        resource: {
          uri: 'file:///path/to/file.txt',
          mimeType: 'text/plain',
          text: 'File contents here',
        },
      });
    });

    it('should map MCP blob resource to ACP resource ContentBlock', () => {
      const mcpResource: MCPEmbeddedResource = {
        type: 'resource',
        resource: {
          uri: 'file:///path/to/image.png',
          mimeType: 'image/png',
          blob: 'base64blobdata==',
        },
      };

      const result = mapMCPContentToACPContentBlock(mcpResource);

      expect(result).toEqual({
        type: 'resource',
        resource: {
          uri: 'file:///path/to/image.png',
          mimeType: 'image/png',
          blob: 'base64blobdata==',
        },
      });
    });

    it('should handle resource without mimeType', () => {
      const mcpResource: MCPEmbeddedResource = {
        type: 'resource',
        resource: {
          uri: 'file:///path/to/file',
          text: 'Content',
        },
      };

      const result = mapMCPContentToACPContentBlock(mcpResource);

      expect(result).toEqual({
        type: 'resource',
        resource: {
          uri: 'file:///path/to/file',
          mimeType: undefined,
          text: 'Content',
        },
      });
    });

    it('should handle resource without content (empty text)', () => {
      const mcpResource: MCPEmbeddedResource = {
        type: 'resource',
        resource: {
          uri: 'file:///path/to/empty',
        },
      };

      const result = mapMCPContentToACPContentBlock(mcpResource);

      expect(result).toEqual({
        type: 'resource',
        resource: {
          uri: 'file:///path/to/empty',
          mimeType: undefined,
          text: '',
        },
      });
    });
  });

  describe('Unknown content type handling', () => {
    it('should convert unknown content types to JSON text', () => {
      const unknownContent = {
        type: 'unknown' as const,
        data: 'some data',
      } as unknown as MCPContent;

      const result = mapMCPContentToACPContentBlock(unknownContent);

      expect(result.type).toBe('text');
      expect((result as { type: 'text'; text: string }).text).toContain('unknown');
    });
  });
});

describe('mapMCPResultToACPToolCallContent', () => {
  it('should map empty array to empty array', () => {
    const result = mapMCPResultToACPToolCallContent([]);
    expect(result).toEqual([]);
  });

  it('should wrap each content item in Content structure', () => {
    const mcpContents: MCPContent[] = [
      { type: 'text', text: 'First' },
      { type: 'text', text: 'Second' },
    ];

    const result = mapMCPResultToACPToolCallContent(mcpContents);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: 'content',
      content: { type: 'text', text: 'First' },
    });
    expect(result[1]).toEqual({
      type: 'content',
      content: { type: 'text', text: 'Second' },
    });
  });

  it('should handle mixed content types', () => {
    const mcpContents: MCPContent[] = [
      { type: 'text', text: 'Some text' },
      { type: 'image', data: 'imagedata==', mimeType: 'image/png' },
      {
        type: 'resource',
        resource: { uri: 'file:///test', text: 'resource content' },
      },
    ];

    const result = mapMCPResultToACPToolCallContent(mcpContents);

    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('content');
    expect(result[1].type).toBe('content');
    expect(result[2].type).toBe('content');
  });
});

describe('createErrorToolCallContent', () => {
  it('should create error content with message', () => {
    const result = createErrorToolCallContent('Something went wrong');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'content',
      content: {
        type: 'text',
        text: 'Error: Something went wrong',
      },
    });
  });

  it('should handle empty error message', () => {
    const result = createErrorToolCallContent('');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'content',
      content: {
        type: 'text',
        text: 'Error: ',
      },
    });
  });
});

describe('mapToolResultToACPContent', () => {
  it('should map successful result content', () => {
    const content: MCPContent[] = [{ type: 'text', text: 'Success!' }];

    const result = mapToolResultToACPContent(content, false);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'content',
      content: { type: 'text', text: 'Success!' },
    });
  });

  it('should extract error text from error results', () => {
    const content: MCPContent[] = [{ type: 'text', text: 'Tool execution failed' }];

    const result = mapToolResultToACPContent(content, true);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'content',
      content: {
        type: 'text',
        text: 'Error: Tool execution failed',
      },
    });
  });

  it('should combine multiple error text contents', () => {
    const content: MCPContent[] = [
      { type: 'text', text: 'Error line 1' },
      { type: 'text', text: 'Error line 2' },
    ];

    const result = mapToolResultToACPContent(content, true);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'content',
      content: {
        type: 'text',
        text: 'Error: Error line 1\nError line 2',
      },
    });
  });

  it('should handle error result with non-text content', () => {
    const content: MCPContent[] = [
      { type: 'image', data: 'imagedata==', mimeType: 'image/png' },
    ];

    const result = mapToolResultToACPContent(content, true);

    // When error has no text content, map normally
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('content');
  });

  it('should handle empty content array', () => {
    const result = mapToolResultToACPContent([], false);
    expect(result).toEqual([]);
  });

  it('should handle empty error content array', () => {
    const result = mapToolResultToACPContent([], true);
    expect(result).toEqual([]);
  });

  it('should default isError to false', () => {
    const content: MCPContent[] = [{ type: 'text', text: 'Normal result' }];

    const result = mapToolResultToACPContent(content);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'content',
      content: { type: 'text', text: 'Normal result' },
    });
  });
});


describe('isResourceLink', () => {
  /**
   * Parse URI from ContentBlock
   */
  it('should return true for valid resource_link', () => {
    const block = {
      type: 'resource_link',
      uri: 'file:///path/to/resource.txt',
      name: 'resource.txt',
    } as ContentBlock;

    expect(isResourceLink(block)).toBe(true);
  });

  it('should return false for text content', () => {
    const block: ContentBlock = {
      type: 'text',
      text: 'Hello',
    };

    expect(isResourceLink(block)).toBe(false);
  });

  it('should return false for image content', () => {
    const block: ContentBlock = {
      type: 'image',
      data: 'base64data',
      mimeType: 'image/png',
    };

    expect(isResourceLink(block)).toBe(false);
  });

  it('should return false for embedded resource', () => {
    const block: ContentBlock = {
      type: 'resource',
      resource: {
        uri: 'file:///test.txt',
        text: 'content',
      },
    };

    expect(isResourceLink(block)).toBe(false);
  });

  it('should return false for resource_link without uri', () => {
    const block = {
      type: 'resource_link',
      name: 'resource.txt',
    } as ContentBlock;

    expect(isResourceLink(block)).toBe(false);
  });
});

describe('extractResourceLinkUri', () => {
  /**
   * Parse URI from ContentBlock
   */
  it('should extract URI from resource_link', () => {
    const block = {
      type: 'resource_link',
      uri: 'file:///path/to/resource.txt',
      name: 'resource.txt',
    } as ContentBlock;

    expect(extractResourceLinkUri(block)).toBe('file:///path/to/resource.txt');
  });

  it('should return null for non-resource_link content', () => {
    const block: ContentBlock = {
      type: 'text',
      text: 'Hello',
    };

    expect(extractResourceLinkUri(block)).toBeNull();
  });

  it('should return null for resource_link without uri', () => {
    const block = {
      type: 'resource_link',
      name: 'resource.txt',
    } as ContentBlock;

    expect(extractResourceLinkUri(block)).toBeNull();
  });

  it('should handle resource_link with all optional fields', () => {
    const block = {
      type: 'resource_link',
      uri: 'http://example.com/api/data',
      name: 'API Data',
      title: 'Data from API',
      description: 'JSON data from the API endpoint',
      mimeType: 'application/json',
      size: 1024,
    } as ContentBlock;

    expect(extractResourceLinkUri(block)).toBe('http://example.com/api/data');
  });
});

describe('mapMCPResourceContentsToACPContentBlock', () => {
  /**
   * Fetch via appropriate MCP server
   */
  it('should map text resource contents to ACP resource ContentBlock', () => {
    const contents: MCPResourceContents = {
      uri: 'file:///path/to/file.txt',
      mimeType: 'text/plain',
      text: 'File contents here',
    };

    const result = mapMCPResourceContentsToACPContentBlock(contents);

    expect(result).toEqual({
      type: 'resource',
      resource: {
        uri: 'file:///path/to/file.txt',
        mimeType: 'text/plain',
        text: 'File contents here',
      },
    });
  });

  it('should map blob resource contents to ACP resource ContentBlock', () => {
    const contents: MCPResourceContents = {
      uri: 'file:///path/to/image.png',
      mimeType: 'image/png',
      blob: 'base64encodeddata==',
    };

    const result = mapMCPResourceContentsToACPContentBlock(contents);

    expect(result).toEqual({
      type: 'resource',
      resource: {
        uri: 'file:///path/to/image.png',
        mimeType: 'image/png',
        blob: 'base64encodeddata==',
      },
    });
  });

  it('should handle text resource without mimeType', () => {
    const contents: MCPResourceContents = {
      uri: 'file:///path/to/file',
      text: 'Content without mime type',
    };

    const result = mapMCPResourceContentsToACPContentBlock(contents);

    expect(result).toEqual({
      type: 'resource',
      resource: {
        uri: 'file:///path/to/file',
        mimeType: undefined,
        text: 'Content without mime type',
      },
    });
  });

  it('should handle blob resource without mimeType', () => {
    const contents: MCPResourceContents = {
      uri: 'file:///path/to/binary',
      blob: 'binarydata==',
    };

    const result = mapMCPResourceContentsToACPContentBlock(contents);

    expect(result).toEqual({
      type: 'resource',
      resource: {
        uri: 'file:///path/to/binary',
        mimeType: undefined,
        blob: 'binarydata==',
      },
    });
  });

  it('should handle empty text content', () => {
    const contents: MCPResourceContents = {
      uri: 'file:///empty.txt',
      mimeType: 'text/plain',
      text: '',
    };

    const result = mapMCPResourceContentsToACPContentBlock(contents);

    expect(result).toEqual({
      type: 'resource',
      resource: {
        uri: 'file:///empty.txt',
        mimeType: 'text/plain',
        text: '',
      },
    });
  });
});
