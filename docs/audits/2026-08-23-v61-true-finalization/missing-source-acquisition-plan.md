# V6.1 Missing Source Acquisition Plan

Generated: 2026-08-23T07:32:58.129Z

## Boundary

The full corpus has 1092 missing source rows and 13 hash-mismatch/corrupted rows. This plan does not claim that all rows are needed to form a 400-section Gold; it records the full recovery queue and a metadata-only P0 coverage projection.

## Exact external inputs required

- Missing original source bytes: 1092 rows.
- Manual reconciliation for hash-mismatch/corrupt candidates: 13 rows.
- Lower-bound metadata projection to reach 400 verified sections: 45 additional rows / 280 sections.
- The lower-bound projection is not Gold evidence until each original file is supplied and hash-verified.

## Priority rules

- P0: sources whose metadata section count most quickly covers the remaining Gold section gap.
- P1: sources needed for supplier/document-family/split diversity after P0 source verification.
- P2: remaining archive recovery and duplicate-family reconciliation.

## Grouped inventory

| group | rows | metadata sections |
|---|---:|---:|
| SUPPLIER_UNPROVEN \| travel_product \| development | 557 | 1071 |
| SUPPLIER_UNPROVEN \| travel_product \| calibration | 136 | 260 |
| SUPPLIER_UNPROVEN \| travel_product \| frozen | 123 | 231 |
| SUPPLIER_UNPROVEN \| non_travel \| frozen | 29 | 0 |
| SUPPLIER_UNPROVEN \| non_travel \| calibration | 18 | 0 |
| SUPPLIER_UNPROVEN \| non_travel \| development | 105 | 0 |
| SUPPLIER_UNPROVEN \| corrupt \| development | 85 | 0 |
| SUPPLIER_UNPROVEN \| corrupt \| calibration | 22 | 0 |
| SUPPLIER_UNPROVEN \| corrupt \| frozen | 17 | 0 |

## P0 coverage projection (not Gold)

| corpus_id | expected filename | split | metadata sections |
|---|---|---|---:|
| 25493323f8881e1f0dc68ddf6134fa952fcd88126dfd79c7be2094684e42315c:524 | ★투어폰 26년 7-8월 백두산 ADM증편-목(3박)일(4박)남파포함.hwp | development | 11 |
| c31f014816019468b0526067e89fed213da0e4f6a250e5948cf32052f445bd11:571 | ☆CA 통합 일정표_2026년 하계.hwp | frozen | 11 |
| 028cdd55be546db81e3e608a092a9f3f85c9472964bf5f682900c3d7a515954b:609 | 1-2. 투어비 [BX] 3월선발권 라오스-관광팩-하계-26년 0228-1018 (0310수정).hwp | development | 9 |
| 863a60fb75c0755102554321ecbd891321159d6da0958ed342fbfcab09ceb47d:605 | 1-1. 투어비 [BX] 0531 선발권 라오스-관광팩-5월.hwp | development | 9 |
| 028480267733147561d5ee4e5961400e799c000b121929dad5dc99c8712d8745:526 | ★투어폰 26년 8-10월 백두산 0828 발권-.hwp | development | 8 |
| 25e764d2534ffd1b60a7f38990451cf94f189af75e6ed67396f404294c95af80:63 | [0629발권] 0901 ~1021 장가계 패키지(등급통합) - 컴 9%.hwp | development | 8 |
| 34689ec385972933a9dde08e64884351833ed895795ab6f9107ce9e29811105b:65 | [0716발권] 0901 ~1021 장가계 패키지(등급통합) - 컴 9%.hwp | frozen | 8 |
| 499f3a12a2b27d166ae3a6bccc6424cc7f56d7f723b441d35c2deedb793b4f74:294 | [BX전세기] 0630 ~0829 월 장가계 패키지(등급통합) - 컴 9%.hwp | development | 8 |
| 66f970dc6d4823eaf96073b1e8c40d2bd64ba0bf42b863c4656ebc4ff65cf54f:613 | 1. 라오스 [BX] 26년 5월 스팟특가 (실속,노노) 주2회 목,일 PKG - 0429선발 - 컴10%  - 0422.hwp | calibration | 8 |
| 81f42c02fdc520a37e065424e2aacbbde88962f85da16814ffafd8d6e694965f:522 | ★투어폰 26년 5-9월 백두산 0612 발권.hwp | calibration | 8 |
| b850062d5c71baa0cd15b155ffa986413c633bdff69b37d84b992230d6d98d21:456 | ★6~10월 장가계 (0520발권).hwp | development | 8 |
| cbbbe6c16c1443a980c8a9c9e3c8c05fa72b1fb82ca81af774aa1bfa003f74db:525 | ★투어폰 26년 7-9월 백두산 0730 발권.hwp | calibration | 8 |
| e3086b5c286fdf0fb7a04dfe94f386ae2edba34906143a34aae79e3f1dd3ed43:74 | [0729발권] 0901 ~1024 장가계 패키지(등급통합) - 컴 9%.hwp | calibration | 8 |
| 0e0af7d636c98b396f99b00b053ced4a54078efc80d8b4d06c10fab2d7dd54b0:312 | [LJ-7월선발] 부산출발-나트랑&달랏 3박,4박-패키지_(0702).hwp | frozen | 7 |
| dd7f45e1e56c65e89001bb03208bf58a3b172f1280bb5ba9abe830341e5cdc07:334 | [TW-6월선발] 부산출발-나트랑&달랏 3박,4박-패키지_(0610).hwp | development | 7 |
| 026c30c5612421a660aeec1fb9cebfa61080af9b2760ef18eafc60f097204e3a:455 | ★6~10월 장가계 (0429발권).hwp | frozen | 6 |
| 0d4405d3072818c4660ca99e2c9b9dc23f55718c90c985de457e119038d31dba:152 | [요금표]라오스 BX 오후출발 26년 4~6월 - 4월발권.hwp | development | 6 |
| 25610226671cc412a1505fc58661e8878412ab6fea87fd4375e8df5625d9ecd5:454 | ★6~10월 장가계 (0429발권)_투어폰_9%.hwp | calibration | 6 |
| 4b7f91bfa33c160a422ef285c2fc4840493f5206feaa56a40de892f02da509a7:427 | ★[BX]NEW 장가계PACK 0630~0829 하드블럭(유류변동X).hwp | development | 6 |
| 58dec4aef0ef3017fadf462501db7362ce0be5a2f9db03d28fccaba88ff8f69c:701 | 관광PKG [BX전세기] 광주 망산 실속&품격&고품격 (0721).hwp | development | 6 |
| 6907af0e5a89f62d600cbb1345116338dc2dba2128ce4549ce568e30078d038a:110 | [관광]4~10월 [BX]라오스PKG (스마트, 프리미엄)-3월26일까지선발(0225수정) 밴드.hwp | development | 6 |
| 89f13887f70103d42cceae029b4a277f2f077c25e15f187dc31f9fa9ce04edf6:330 | [LJ전세기] 계림 잔여일자 특가 0424금6일 품격,고픔격 0501금6일 품격,고품격,망산 0505화5일 품격,고품격,망산 패키지 (0403 수정).hwp | development | 6 |
| a065a4b6f23b84c4933ae951c00257441eb2468ae4211f61e14653c8b8098a0e:243 | [BX-7월선발] 부산출발-나트랑&달랏 3박5일-패키지_(0702).hwp | development | 6 |
| a5beb3d40ab5e5a94b3a19f8d57257d0f6edebbad2f67f8aa6c3dec6aa37c683:242 | [BX-5월선발] 부산출발-나트랑&달랏 3박5일-패키지_(0430).hwp | calibration | 6 |
| ac0b794beb90cecbd633c79e98ebe59662f6730ff54760a6fd56c7e1c6668709:149 | [요금표]2026년 베트남 추석 특가 모음 PKG-0813.hwp | development | 6 |
| cf835f5293ed2ffd4d7fab35cd76f76cc7a928f249168f73b8521c170e6077eb:702 | 관광PKG [BX전세기] 광주 망산 실속&품격&고품격 (0805).hwp | development | 6 |
| d9d1dd8908e6dea524fcc088e0275f4c7d5e50e923891a870e1379abc067719f:425 | ★[BX]장가계PACK 요금표 26년 6월~10월(0611 발권)0528.hwp | calibration | 6 |
| f20c455e3200a9810e43978512f7474a145ce802f01f8f1d094eba88cdb475ab:426 | ★[BX]장가계PACK 요금표 26년 7월~10월(0729 발권).hwp | development | 6 |
| f81b59bcf362731d54fd75555b26efada7c0b0b2a419ab0d655ba134bd811378:797 | 부산출발 황산 전세기.hwp | frozen | 6 |
| fec3e784b562b5371b446ac65d2d606bd13d51cb1603f83fc2eb6797a61baa73:105 | [7C전세기] 계림 실속, 품격, 고품격 9월-11월 패키지 (0623 수정).hwp | development | 6 |
| 04ead8ee7cfadbed9032c4d288cc20be0dd90e168adab604c1bea07b818e7189:338 | [VN-4월선발] 하노이 4~9월 요금표-0428발권.hwp | development | 5 |
| 06deb0e932e9c2e2ba349d4ce8fee10e700fcd442be3a999dc89730b5e42fd9f:519 | ★투어폰 26년 4-10월 백두산 0430 발권.hwp-0330.hwp | development | 5 |
| 27aab88bbbc4b82a5092e7ef0c43c182f445d44bab82b68429dff03155de85b9:1033 | BX마홍(자유포함,마홍심)패키지 0731TL.hwp | development | 5 |
| 896b75b82c8c7da8597c8c06a302d3d6ec6d54ca9e8baf6cd715840ea89c0ad2:1111 | BX마홍(자유포함,마홍심)패키지 0528TL.hwp | frozen | 5 |
| 8c1bf8dfd2b0ec76008c7370d73697307c754b512582ec9f29e3df53eb948295:922 | BX마홍(자유포함,마홍심)패키지 0327TL (1).hwp | development | 5 |
| 91b2f0de1aa035e845b1b98a4f74d6773b307d5855ee066b2e6ea10e23efb76f:932 | CA북경관광4색패키지 0804.hwp | development | 5 |
| 9c68f158b5d18a48f796191c47b68ea3126e4ad67161b9a5173256f359a9fac0:336 | [VJ-특가] 하노이 5~10월 스팟특가 요금표_0428.hwp | development | 5 |
| 006bd45df55584e0d83a99c20aaeccb2e72839e29c9bdf76d55d6ef5ba9b889f:543 | ★ID투어 부산출발 푸꾸옥 [실속&고품격] PKG 5,6일 VJ 3월그룹가(0306).hwp | frozen | 4 |
| 107e6f70b009f7088c3a8e5e255f327fed2d53b2e47c095772c99cd7c295d5a9:783 | 밴드 스팟 ★ID투어 부산출발 푸꾸옥 [실속&고품격] PKG 5,6일 ZE_5월선발가(0519).hwp | frozen | 4 |
| 1ac8ca15383a2bb7e29321a05aa07a0869621e7d195f3c0c65fa6120af50d2d0:1120 | BX서안(구채구,칠채산)패키지 0427TL (1).hwp | development | 4 |
| 27e46159e6b79ca393830b66326e0011c2eb280d83c17f9b33b83aa36a16a492:268 | [BX] 연길 04월~10월 실속, 품격 패키지 (04월30일 발권조건) 04.02.hwp | development | 4 |
| 2f7195977d40242cdb3e8582ecf31b41fe2492ded91b4985489c333c7df0d826:448 | ★5~6월 장가계 (0429발권).hwp | frozen | 4 |
| 3124d7df347552a7e2cb9acba704cf23380e79d0ebb670c1039ea14c92b29494:419 | ★[BX] 서안똑딱 요금표 (6월프로모션요금표).hwp | development | 4 |
| 31f89cce3f35a06eb4e42a8d449a9fd9d9f4fc692dd284bef3e7a5bb5340f5dd:1136 | BX코타2색,3색골프 0731TL.hwp | calibration | 4 |
| 3206943c15224ed27c6fe8133bef977839ebe0c99de5c0b7698ef277591aed12:459 | ★계림전세기-천저우망산PACK(0403~0526).hwp | development | 4 |

## Required acquisition record per row

- immutable original bytes
- expected source hash and observed SHA-256
- supplier/document family/source system/upload batch when supplied by the operator
- duplicate-family decision
- source location and acquisition timestamp

No synthetic source, parser output, or metadata-only row may be promoted to Gold.
