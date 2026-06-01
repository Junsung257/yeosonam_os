declare module '@dnd-kit/core' {
  import type { ComponentType, ReactNode } from 'react';

  export type DragStartEvent = {
    active: { id: string | number; data?: { current?: Record<string, unknown> } };
  };

  export type DragEndEvent = {
    active: { id: string | number; data?: { current?: Record<string, unknown> } };
    over: { id: string | number; data?: { current?: Record<string, unknown> } } | null;
  };

  export const DndContext: ComponentType<{
    children?: ReactNode;
    sensors?: unknown;
    onDragStart?: (event: DragStartEvent) => void;
    onDragEnd?: (event: DragEndEvent) => void;
  }>;
  export const DragOverlay: ComponentType<{ children?: ReactNode }>;
  export const PointerSensor: unknown;
  export function useSensor(sensor: unknown, options?: Record<string, unknown>): unknown;
  export function useSensors(...sensors: unknown[]): unknown;
  export function useDraggable(args: { id: string; data?: Record<string, unknown> }): {
    attributes: Record<string, unknown>;
    listeners: Record<string, unknown> | undefined;
    setNodeRef: (node: HTMLElement | null) => void;
    transform: { x: number; y: number } | null;
    isDragging: boolean;
  };
  export function useDroppable(args: { id: string; data?: Record<string, unknown> }): {
    setNodeRef: (node: HTMLElement | null) => void;
    isOver: boolean;
  };
}

declare module '@google/generative-ai' {
  export enum SchemaType {
    STRING = 'string',
    NUMBER = 'number',
    INTEGER = 'integer',
    BOOLEAN = 'boolean',
    ARRAY = 'array',
    OBJECT = 'object',
  }

  export type ResponseSchema = Record<string, unknown>;

  export type GenerativeContentResponse = {
    text(): string;
    candidates?: unknown[];
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      cachedContentTokenCount?: number;
      totalTokenCount?: number;
    };
  };

  export type GenerateContentResult = {
    response: GenerativeContentResponse;
  };

  export type CountTokensResult = {
    totalTokens: number;
  };

  export type GenerativeModel = {
    generateContent(input: unknown): Promise<GenerateContentResult>;
    generateContentStream?(input: unknown): Promise<unknown>;
    countTokens?(input: unknown): Promise<CountTokensResult>;
  };

  export class GoogleGenerativeAI {
    constructor(apiKey: string);
    getGenerativeModel(config: Record<string, unknown>): GenerativeModel;
  }
}

declare module '@vercel/otel' {
  export function registerOTel(options?: Record<string, unknown>): void;
}

declare module 'node:fs/promises' {
  export function readFile(path: string | URL, encoding?: BufferEncoding | null): Promise<Buffer>;
  export function readFile(path: string | URL, options: { encoding?: BufferEncoding | null; flag?: string } | BufferEncoding): Promise<string | Buffer>;
}

declare module 'node:path' {
  export function join(...paths: string[]): string;
}
