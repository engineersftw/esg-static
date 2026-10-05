# YouTube Sync Workflow

This workflow automatically syncs videos and playlists from the YouTube channel to the Astro content collections.

## Setup

### 1. Add YouTube API Key to GitHub Secrets

1. Go to your GitHub repository settings
2. Navigate to **Secrets and variables** → **Actions**
3. Create a new secret named `YOUTUBE_API_KEY`
4. Paste your YouTube Data API key (from Google Cloud Console)

### 2. Optional: Configure Schedule

The workflow runs daily at **2 AM UTC** (10 AM Singapore Time). To change this:

Edit `.github/workflows/sync-youtube.yml` and modify the cron schedule:

```yaml
on:
  schedule:
    - cron: '0 2 * * *'  # Change this line
```

Use [crontab guru](https://crontab.guru/) to help format the cron expression.

## Workflow Behavior

- **Trigger**: Runs automatically on schedule or manually via workflow dispatch
- **Steps**:
  1. Checkout the repository
  2. Setup Node.js and pnpm
  3. Install dependencies
  4. Run `yt-export` to sync with YouTube
  5. Create a PR if changes are detected
- **Output**: 
  - If no changes: workflow completes silently
  - If changes detected: creates or updates a PR on the `youtube-sync` branch

## Manual Trigger

To manually run the sync:

1. Go to **Actions** in your GitHub repository
2. Select **Sync YouTube Channel**
3. Click **Run workflow**

## What Gets Synced

The workflow syncs:
- Video titles, descriptions, and thumbnails
- Playlist metadata and membership
- Video publish dates
- Two-way links between videos and playlists

Existing data is preserved:
- Manual edits to video/presenter/organization links
- Curated slugs and categories
- Inactive status

See the [yt-export documentation](../../packages/yt-export/README.md) for full details.

## Troubleshooting

### Workflow fails with API key error

- Verify the API key is valid and hasn't been revoked
- Check that it has YouTube Data API access enabled
- Ensure the key is correctly set in GitHub secrets

### Workflow runs but creates no PR

This is normal—it means there are no changes to sync.

### PR created but with wrong content

- Check the workflow run logs for errors
- Verify the yt-export command is correct
- Ensure content directory path is accurate

## Security

- The YouTube API key is stored securely in GitHub secrets
- Never commit the API key to the repository
- The workflow only has permissions to read/write the repository
