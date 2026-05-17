import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import app from '../server.js';

let tempRepoDir;

describe('Git Dashboard API Integration Tests', () => {
  beforeAll(() => {
    // Create a temporary directory
    tempRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-test-'));
    
    // Initialize git repo with 'main' branch
    execSync('git init -b main', { cwd: tempRepoDir });
    execSync('git config user.email "test@example.com"', { cwd: tempRepoDir });
    execSync('git config user.name "Test User"', { cwd: tempRepoDir });
    
    // Create initial commit
    fs.writeFileSync(path.join(tempRepoDir, 'test.txt'), 'Hello World\n');
    execSync('git add test.txt', { cwd: tempRepoDir });
    execSync('git commit -m "Initial commit"', { cwd: tempRepoDir });

    // Create another branch
    execSync('git branch feature-1', { cwd: tempRepoDir });
  });

  afterAll(() => {
    // Cleanup
    fs.rmSync(tempRepoDir, { recursive: true, force: true });
  });

  it('GET /api/status should return repository status', async () => {
    const res = await request(app)
      .get('/api/status')
      .query({ repo: tempRepoDir });
      
    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
    expect(res.body.status.current).toBe('main');
    expect(res.body.branches).toBeDefined();
    expect(res.body.branches.all).toContain('main');
    expect(res.body.branches.all).toContain('feature-1');
  });

  it('GET /api/log should return commit history', async () => {
    const res = await request(app)
      .get('/api/log')
      .query({ repo: tempRepoDir });

    expect(res.status).toBe(200);
    expect(res.body.commits).toBeDefined();
    expect(res.body.commits.length).toBeGreaterThan(0);
    expect(res.body.commits[0].subject).toBe('Initial commit');
  });

  it('POST /api/checkout should change current branch', async () => {
    const res = await request(app)
      .post('/api/checkout')
      .send({ repo: tempRepoDir, branch: 'feature-1' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify status changed
    const statusRes = await request(app)
      .get('/api/status')
      .query({ repo: tempRepoDir });
    expect(statusRes.body.status.current).toBe('feature-1');
  });

  it('POST /api/amend should update the last commit', async () => {
    const res = await request(app)
      .post('/api/amend')
      .send({ repo: tempRepoDir, message: 'Amended initial commit' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify log changed
    const logRes = await request(app)
      .get('/api/log')
      .query({ repo: tempRepoDir });
    expect(logRes.body.commits[0].subject).toBe('Amended initial commit');
  });
});
