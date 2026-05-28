import re

fixes = {
    # content-factory/[cardNewsId]/route.ts — .then(r => r).catch()
    r'src/app/api/content-factory/\[cardNewsId\]/route.ts': [
        (r'(\.maybeSingle\(\))\s*\.then\(\(r:\s*\{[^}]+\}\)\s*=>\s*r\)\s*\.catch\(\(\)\s*=>\s*\(\{\s*data:\s*null,\s*error:\s*null\s*\}\)\)',
         r'\1')
    ],

    # jarvis/approve/route.ts — .then(() => {}).catch(() => {})
    r'src/app/api/jarvis/approve/route.ts': [
        (r'(supabaseAdmin\.from\([^)]+\)\.[^;]+)\.then\(\(\)\s*=>\s*\{\}\)\.catch\(\(\)\s*=>\s*\{\}\)',
         r'void(\1)')
    ],

    # cron/affiliate-live-celebration/route.ts
    r'src/app/api/cron/affiliate-live-celebration/route.ts': [
        (r'(supabaseAdmin\.from\([^)]+\)\.[^;]+)\.then\(\(\)\s*=>\s*\{\}\)\.catch\(\(\)\s*=>\s*\{\}\)',
         r'void(\1)')
    ],

    # cron/affiliate-lifetime-commission/route.ts
    r'src/app/api/cron/affiliate-lifetime-commission/route.ts': [
        (r'(supabaseAdmin\.from\([^)]+\)\.[^;]+)\.then\(\(\)\s*=>\s*\{\}\)\.catch\(\(\)\s*=>\s*\{\}\)',
         r'void(\1)')
    ],

    # cron/affiliate-anomaly-detect/route.ts
    r'src/app/api/cron/affiliate-anomaly-detect/route.ts': [
        (r'(supabaseAdmin\.from\([^)]+\)\.[^;]+)\.then\(\(\)\s*=>\s*\{\}\)\.catch\(\(\)\s*=>\s*\{\}\)',
         r'void(\1)')
    ],

    # cron/affiliate-settlement-draft/route.ts
    r'src/app/api/cron/affiliate-settlement-draft/route.ts': [
        (r'(supabaseAdmin\.from\([^)]+\)\.[^;]+)\.then\(\(\)\s*=>\s*\{\}\)\.catch\(\(\)\s*=>\s*\{\}\)',
         r'void(\1)')
    ],

    # cron/settlement-auto/route.ts
    r'src/app/api/cron/settlement-auto/route.ts': [
        (r'(supabaseAdmin\.from\([^)]+\)\.[^;]+)\.then\(\(\)\s*=>\s*\{\}\)\.catch\(\(\)\s*=>\s*\{\}\)',
         r'void(\1)')
    ],

    # upload/route.ts — .then(() => {}).catch(...)
    r'src/app/api/upload/route.ts': [
        (r'(supabaseAdmin\.from\([^)]+\)\.[^;]+)\.then\(\(\)\s*=>\s*\{\}\)\.catch\(\([^)]+\)\)',
         r'void(\1)')
    ],

    # packages/[id]/approve/route.ts — .then(() => {}, () => {})
    r'src/app/api/packages/\[id\]/approve/route.ts': [
        (r'(supabaseAdmin\.from\([^)]+\)\.[^;]+)\.then\(\(\)\s*=>\s*\{\},\s*\(\)\s*=>\s*\{\}\)',
         r'void(\1)')
    ],
}

import os

base = r'c:\Users\admin\Desktop\여소남OS'
for relpath, rules in fixes.items():
    fullpath = os.path.join(base, relpath)
    if not os.path.exists(fullpath):
        print(f'NOT FOUND: {fullpath}')
        continue
    
    with open(fullpath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    for pattern, replacement in rules:
        new_content = re.sub(pattern, replacement, content)
        if new_content != content:
            print(f'FIXED: {relpath}')
            content = new_content
        else:
            print(f'NO MATCH: {relpath}')
    
    with open(fullpath, 'w', encoding='utf-8') as f:
        f.write(content)

print('\nDone!')
