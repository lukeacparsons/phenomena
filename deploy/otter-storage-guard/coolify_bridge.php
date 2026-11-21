<?php
// Uses Coolify's installed models and native cleanup job; contains no credentials.
require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$server = App\Models\Server::where('uuid', 'of4fec7d9pc7vccw3h8hvimb')->firstOrFail();
$action = $argv[1] ?? 'inspect';
$keys = ['docker_cleanup_frequency', 'force_docker_cleanup', 'docker_cleanup_threshold',
    'delete_unused_volumes', 'delete_unused_networks', 'disable_application_image_retention'];
if ($action === 'configure') {
    $before = $server->settings->only($keys);
    $server->settings->update([
        'docker_cleanup_frequency' => '7 * * * *',
        'force_docker_cleanup' => true,
        'docker_cleanup_threshold' => 75,
        'delete_unused_volumes' => false,
        'delete_unused_networks' => false,
        'disable_application_image_retention' => false,
    ]);
    echo json_encode(['before' => $before, 'after' => $server->settings->fresh()->only($keys)]);
    exit;
}
$active = App\Actions\Server\CleanupDocker::activeDeployment($server);
$running = App\Models\DockerCleanupExecution::where('server_id', $server->id)
    ->where('status', 'running')->where('created_at', '>=', now()->subMinutes(12))->exists();
if ($action === 'dispatch') {
    if ($active || $running) {
        echo json_encode(['dispatched' => false, 'reason' => $active ? 'active deployment' : 'cleanup running']);
    } else {
        // Non-manual mode preserves the build-cache safety checks if a deployment starts meanwhile.
        App\Jobs\DockerCleanupJob::dispatch($server, false, false, false);
        echo json_encode(['dispatched' => true]);
    }
    exit;
}
if ($action !== 'inspect') {
    throw new RuntimeException('Unknown action');
}
$latest = App\Models\ApplicationDeploymentQueue::where(function ($q) use ($server) {
    $q->where('server_id', $server->id)->orWhere('build_server_id', $server->id);
})->whereIn('status', ['finished', 'failed', 'cancelled'])
    ->orderByDesc('updated_at')->first(['id', 'status', 'updated_at']);
$cleanup = App\Models\DockerCleanupExecution::where('server_id', $server->id)->orderByDesc('id')
    ->first(['id', 'status', 'message', 'created_at', 'finished_at']);
echo json_encode([
    'active_deployment' => $active ? $active->deployment_uuid : null,
    'cleanup_running' => $running,
    'latest_deployment' => $latest ? ['id' => $latest->id, 'status' => $latest->status,
        'at' => $latest->updated_at->timestamp] : null,
    'latest_cleanup' => $cleanup ? ['id' => $cleanup->id, 'status' => $cleanup->status,
        'started_at' => $cleanup->created_at->timestamp,
        'finished_at' => $cleanup->finished_at ? strtotime($cleanup->finished_at) : null,
        'skipped_cache' => str_contains($cleanup->message ?? '', 'Skipped:') ||
            str_contains($cleanup->message ?? '', 'No cleanup needed'),
        'message' => $cleanup->message] : null,
    'settings' => $server->settings->only($keys),
]);
