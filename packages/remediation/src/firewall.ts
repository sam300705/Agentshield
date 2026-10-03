import Parser from "tree-sitter";
import Bash from "tree-sitter-bash";
import { PrismaClient, SafaEventType, Severity } from "@prisma/client";

const prisma = new PrismaClient();

const DESTRUCTIVE_COMMANDS = new Set(["rm", "mkfs", "dd", "chmod", "chown", "mv", "cp"]);
const RESTRICTED_PATHS = new Set(["/etc/shadow", "/var/run/docker.sock", "/", "/etc/passwd", "/root"]);

export class ASTFirewallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ASTFirewallError";
  }
}

export async function validateAst(script: string, scanId?: string, userId?: string): Promise<void> {
  const parser = new Parser();

  parser.setLanguage(Bash);

  const tree = parser.parse(script);

  let blockedCommand = "";
  let blockedReason = "";

  function walk(node: Parser.SyntaxNode) {
    if (node.type === "command_name") {
      const commandText = node.text;
      if (DESTRUCTIVE_COMMANDS.has(commandText)) {
        blockedCommand = commandText;
        blockedReason = `Destructive command detected: ${commandText}`;
        return true;
      }
    } else if (node.type === "word") {
      const wordText = node.text;
      if (RESTRICTED_PATHS.has(wordText)) {
        blockedCommand = wordText;
        blockedReason = `Restricted path access detected: ${wordText}`;
        return true;
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && walk(child)) {
        return true;
      }
    }

    return false;
  }

  const violationDetected = walk(tree.rootNode);

  if (violationDetected) {
    const errorMsg = `AST Firewall blocked script execution. Reason: ${blockedReason}`;

    try {
      await prisma.safaAuditLog.create({
        data: {
          eventType: SafaEventType.DESTRUCTIVE_COMMAND_BLOCKED,
          severity: Severity.CRITICAL,
          description: errorMsg,
          metadata: {
            modelVersion: "N/A",
            latencyMs: 0,
            tokenCount: 0,
            rawInput: script,
            blockedCommand: blockedCommand,
            timestamp: new Date().toISOString()
          },
          scanId: scanId || null,
          userId: userId || null,
        }
      });
    } catch (dbErr) {
      console.error("Failed to log DESTRUCTIVE_COMMAND_BLOCKED to database", dbErr);
    }

    throw new ASTFirewallError(errorMsg);
  }
}
