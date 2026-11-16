<?php
declare(strict_types=1);
return ['app_name' => 'tcc-hyperf-async', 'app_env' => 'prod', 'scan_cacheable' => filter_var(getenv('SCAN_CACHEABLE') ?: 'true', FILTER_VALIDATE_BOOL)];
