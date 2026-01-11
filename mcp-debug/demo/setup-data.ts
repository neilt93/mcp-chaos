import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const WORKSPACE = '/private/tmp/demo-workspace';

const files: Record<string, string> = {
  'readme.txt': `Welcome to your Demo Workspace!
================================

This is a sample workspace to demonstrate MCP file operations.

Folders:
- documents/  - Your important documents
- projects/   - Your code projects

Feel free to explore!
`,

  'documents/report.txt': `Q4 2024 Sales Report
====================

Executive Summary:
- Total Revenue: $2.4M (up 15% from Q3)
- New Customers: 142
- Customer Retention: 94%

Key Highlights:
1. Enterprise sales grew by 28%
2. SMB segment showed steady growth
3. APAC region exceeded targets

Next Quarter Goals:
- Launch new product line
- Expand into European market
- Increase marketing spend by 20%
`,

  'documents/notes.md': `# Meeting Notes - Monday Standup

## Attendees
- Alice (PM)
- Bob (Dev)
- Carol (Design)

## Discussion
- Sprint velocity looking good
- Need to finalize API design by Friday
- Design review scheduled for Wednesday

## Action Items
- [ ] Bob: Complete auth module
- [ ] Carol: Update mockups
- [ ] Alice: Send stakeholder update
`,

  'documents/todo.txt': `My Todo List
============

High Priority:
1. Review pull requests
2. Update documentation
3. Fix login bug (#234)

Medium Priority:
4. Refactor database queries
5. Add unit tests
6. Update dependencies

Low Priority:
7. Clean up old branches
8. Organize bookmarks
`,

  'projects/app/main.py': `#!/usr/bin/env python3
"""
Simple Demo Application
"""

def greet(name: str) -> str:
    """Return a greeting message."""
    return f"Hello, {name}! Welcome to the demo."

def calculate_sum(numbers: list[int]) -> int:
    """Calculate the sum of a list of numbers."""
    return sum(numbers)

def main():
    print(greet("World"))
    result = calculate_sum([1, 2, 3, 4, 5])
    print(f"Sum: {result}")

if __name__ == "__main__":
    main()
`,

  'projects/app/config.json': `{
  "app_name": "Demo App",
  "version": "1.0.0",
  "debug": true,
  "database": {
    "host": "localhost",
    "port": 5432,
    "name": "demo_db"
  },
  "features": {
    "dark_mode": true,
    "notifications": true
  }
}
`,

  'projects/data/users.json': `{
  "users": [
    {
      "id": 1,
      "name": "Alice Johnson",
      "email": "alice@example.com",
      "role": "admin"
    },
    {
      "id": 2,
      "name": "Bob Smith",
      "email": "bob@example.com",
      "role": "developer"
    },
    {
      "id": 3,
      "name": "Carol Williams",
      "email": "carol@example.com",
      "role": "designer"
    }
  ],
  "total": 3,
  "lastUpdated": "2024-01-15"
}
`,

  'projects/data/analytics.csv': `date,page_views,unique_visitors,bounce_rate
2024-01-01,1250,890,32.5
2024-01-02,1340,920,30.1
2024-01-03,1180,850,35.2
2024-01-04,1420,980,28.7
2024-01-05,1560,1050,27.3
2024-01-06,1380,940,31.0
2024-01-07,1290,870,33.8
`,
};

console.log('Setting up demo workspace...\n');

// Create directories
const dirs = [
  '',
  'documents',
  'projects',
  'projects/app',
  'projects/data',
];

for (const dir of dirs) {
  const path = join(WORKSPACE, dir);
  mkdirSync(path, { recursive: true });
  console.log(`Created: ${path}`);
}

// Create files
for (const [relativePath, content] of Object.entries(files)) {
  const fullPath = join(WORKSPACE, relativePath);
  writeFileSync(fullPath, content);
  console.log(`Created: ${fullPath}`);
}

console.log('\n✅ Demo workspace ready at:', WORKSPACE);
console.log('\nYou can now run the chat demo to explore these files!');
