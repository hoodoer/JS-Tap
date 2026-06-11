//go:build windows

package main

import (
	"context"
	"os/exec"
	"syscall"
)

// makeShellCmd creates a cmd.exe invocation with the raw command line.
// Go's exec.Command escapes double quotes as \" which cmd.exe does not
// understand. Using SysProcAttr.CmdLine bypasses Go's escaping so the
// command string reaches cmd.exe exactly as constructed.
func makeShellCmd(ctx context.Context, command string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "cmd.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CmdLine: `cmd.exe /S /C "` + command + `"`,
	}
	return cmd
}
