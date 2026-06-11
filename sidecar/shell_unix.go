//go:build !windows

package main

import (
	"context"
	"os/exec"
)

func makeShellCmd(ctx context.Context, command string) *exec.Cmd {
	return exec.CommandContext(ctx, "/bin/sh", "-c", command)
}
