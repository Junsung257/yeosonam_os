export interface paths {
    "/api/v1/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** API 상태 확인 */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 현재 API 및 데이터베이스 상태 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["V1HealthResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/packages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 공개 여행상품 검색 */
        get: {
            parameters: {
                query?: {
                    destination?: string;
                    date_from?: string;
                    date_to?: string;
                    keyword?: string;
                    limit?: number;
                    offset?: number | null;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 현재 공개 포인터가 가리키는 상품 목록 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["V1PackageListResponse"];
                    };
                };
                /** @description 잘못된 검색 조건 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["V1ErrorResponse"];
                    };
                };
                /** @description 유효하지 않은 API 키 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["V1ErrorResponse"];
                    };
                };
                /** @description 필요한 API 스코프 없음 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["V1ErrorResponse"];
                    };
                };
                /** @description 서버 오류 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["V1ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        /** 조건 기반 공개 여행상품 추천 */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["V1PackageRecommendationBody"];
                };
            };
            responses: {
                /** @description 현재 공개 포인터가 가리키는 추천 상품 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["V1PackageListResponse"];
                    };
                };
                /** @description 잘못된 추천 조건 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["V1ErrorResponse"];
                    };
                };
                /** @description 유효하지 않은 API 키 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["V1ErrorResponse"];
                    };
                };
                /** @description 필요한 API 스코프 없음 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["V1ErrorResponse"];
                    };
                };
                /** @description 서버 오류 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["V1ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        V1HealthResponse: {
            /** @enum {boolean} */
            ok: true;
            data: {
                /** @enum {string} */
                status: "healthy" | "degraded";
                version: string;
                uptime: number;
                /** @enum {string} */
                db: "connected" | "timeout" | "not_configured" | "resource_saver";
                /** Format: date-time */
                timestamp: string;
            };
        };
        V1PublicPackage: {
            id: string;
            title?: string | null;
            display_title?: string | null;
            destination?: string | null;
            duration?: string | number | unknown;
            days?: string | number | unknown;
            nights?: string | number | unknown;
            price?: number | null;
            price_display?: string | null;
            summary?: string | null;
            badges?: unknown[];
            publication_state?: string | null;
            package_revision?: string | number | unknown;
        };
        V1PackageListResponse: {
            /** @enum {boolean} */
            ok: true;
            data: components["schemas"]["V1PublicPackage"][];
            pagination: {
                total: number;
                limit: number;
                offset: number;
            };
            degraded?: boolean;
            reason?: string;
        };
        V1ErrorResponse: {
            /** @enum {boolean} */
            ok: false;
            error: {
                code: string;
                message: string;
                details?: unknown;
            };
            /** Format: date-time */
            timestamp?: string;
        };
        V1PackageRecommendationBody: {
            destination?: string;
            date_from?: string;
            /** @default 2 */
            pax: number;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
