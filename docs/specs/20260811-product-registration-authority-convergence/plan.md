# Plan: Product Registration Authority Convergence

이 spec의 구현 계획과 운영 순서는 다음과 같다.

1. 권위 writer, revision-first commit, tenant/source 경계를 고정한다.
2. V6 workflow와 입력 adapter를 Kernel 경계로 수렴시키고 legacy 직접 writer를 차단한다.
3. pointer-bound snapshot reader와 publication freeze를 검증한다.
4. type-check, lint, domain/full test, build, corpus, live operational gate를 단계별로 기록한다.

Production migration, shadow backfill, live provider 호출, publication freeze 해제는 별도 승인 게이트이며 이 spec의 로컬 계획에서 자동 실행하지 않는다.
