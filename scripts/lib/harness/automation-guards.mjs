import ts from 'typescript';

const CRON_AUTH_MODULE = '@/lib/cron-auth';
const ADMIN_AUTH_MODULE = '@/lib/admin-guard';
const CRON_OBSERVABILITY_MODULE = '@/lib/cron-observability';
const INNGEST_POLICY_MODULE = '@/inngest/runtime-policy';

function parse(source) {
  return ts.createSourceFile('guard-audit.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function hasModifier(node, kind) {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function importedNames(file, moduleName) {
  const names = new Set();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== moduleName) continue;
    for (const element of statement.importClause?.namedBindings?.elements ?? []) {
      if (element.propertyName && element.propertyName.text !== element.name.text) continue;
      names.add(element.name.text);
    }
  }
  return names;
}

function calledIdentifier(node) {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return null;
  return node.expression.text;
}

function statementReturns(statement) {
  if (ts.isReturnStatement(statement)) return true;
  return ts.isBlock(statement) && statement.statements.some((child) => ts.isReturnStatement(child));
}

function negatedCallName(expression) {
  if (!ts.isPrefixUnaryExpression(expression) || expression.operator !== ts.SyntaxKind.ExclamationToken) return null;
  return calledIdentifier(expression.operand);
}

function exportedGet(file) {
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement)
      && statement.name?.text === 'GET'
      && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return { body: statement.body, initializer: null };
    if (!ts.isVariableStatement(statement) || !hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'GET') continue;
      const initializer = declaration.initializer;
      const body = (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) ? initializer.body : null;
      return { body: body && ts.isBlock(body) ? body : null, initializer };
    }
  }
  return null;
}

function directHandlerGuard(body, trusted, markers) {
  if (!body) return null;
  const [first, second] = body.statements;
  if (first && ts.isIfStatement(first) && statementReturns(first.thenStatement)) {
    const name = negatedCallName(first.expression);
    if (name && trusted.has(name) && markers.includes(name)) return name;
  }
  if (!first || !ts.isVariableStatement(first) || !second || !ts.isIfStatement(second)) return null;
  for (const declaration of first.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name)) continue;
    const name = calledIdentifier(declaration.initializer);
    if (name === 'requireCronBearer' && trusted.has(name)
      && ts.isIdentifier(second.expression) && second.expression.text === declaration.name.text
      && statementReturns(second.thenStatement)) return name;
  }
  return null;
}

function localFunctionBody(file, name) {
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement.body ?? null;
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      const initializer = declaration.initializer;
      if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) && ts.isBlock(initializer.body)) {
        return initializer.body;
      }
    }
  }
  return null;
}

function localInitializer(file, name) {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration.initializer ?? null;
    }
  }
  return null;
}

export function analyzeCronRouteAuth(source, markers) {
  const file = parse(source);
  const trusted = importedNames(file, CRON_AUTH_MODULE);
  for (const name of importedNames(file, ADMIN_AUTH_MODULE)) trusted.add(name);
  const get = exportedGet(file);
  if (!get) return null;

  const analyzeInitializer = (initializer, visited = new Set()) => {
    if (!initializer) return null;
    if (ts.isIdentifier(initializer)) {
      if (visited.has(initializer.text)) return null;
      visited.add(initializer.text);
      return analyzeInitializer(localInitializer(file, initializer.text), visited);
    }
    if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
      return ts.isBlock(initializer.body) ? directHandlerGuard(initializer.body, trusted, markers) : null;
    }
    if (!ts.isCallExpression(initializer)) return null;
    const wrapper = calledIdentifier(initializer);
    if (wrapper && ['withCronGuard', 'withAdminGuard'].includes(wrapper) && trusted.has(wrapper)) return wrapper;
    if (wrapper === 'withCronLogging' && importedNames(file, CRON_OBSERVABILITY_MODULE).has(wrapper)) {
      const handler = initializer.arguments[1];
      return ts.isIdentifier(handler)
        ? directHandlerGuard(localFunctionBody(file, handler.text), trusted, markers)
        : analyzeInitializer(handler, visited);
    }
    return null;
  };

  return analyzeInitializer(get.initializer) ?? directHandlerGuard(get.body, trusted, markers);
}

function registeredInngestHandlers(file) {
  const handlers = [];
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement) || !hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (!initializer || !ts.isCallExpression(initializer)
        || !ts.isPropertyAccessExpression(initializer.expression)
        || initializer.expression.name.text !== 'createFunction') continue;
      const candidate = initializer.arguments.at(-1);
      if (candidate && (ts.isArrowFunction(candidate) || ts.isFunctionExpression(candidate)) && ts.isBlock(candidate.body)) handlers.push(candidate.body);
    }
  }
  return handlers;
}

export function hasFailClosedRegisteredInngestHandler(source, marker) {
  const file = parse(source);
  if (!importedNames(file, INNGEST_POLICY_MODULE).has(marker)) return false;
  const handlers = registeredInngestHandlers(file);
  if (handlers.length === 0) return false;
  return handlers.every((body) => {
    const first = body.statements[0];
    return Boolean(first && ts.isIfStatement(first)
      && negatedCallName(first.expression) === marker
      && statementReturns(first.thenStatement));
  });
}
