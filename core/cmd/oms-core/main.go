package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	omscore "github.com/router-for-me/CLIProxyAPI/v7/oms-core"
)

type closer interface{ Close() }

func main() {
	listen := flag.String("listen", "127.0.0.1:8319", "OMS facade loopback address")
	config := flag.String("config", "", "CLIProxyAPI config for production mode")
	mock := flag.Bool("mock", false, "run with fake accounts and no provider traffic")
	flag.Parse()
	host, _, err := net.SplitHostPort(*listen)
	if err != nil || (host != "127.0.0.1" && host != "localhost" && host != "::1") {
		log.Fatal("OMS facade must bind to loopback")
	}
	token := os.Getenv("OMS_CORE_TOKEN")
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	var runtime omscore.Runtime
	var closeMock closer
	var production *omscore.ProductionCore
	serviceErrors := make(chan error, 1)
	if *mock {
		core, err := omscore.NewMockCore([]omscore.Account{
			{Name: "mock-a", AuthID: "mock-auth-a", Provider: "mock-provider", Model: "mock-model"},
			{Name: "mock-b", AuthID: "mock-auth-b", Provider: "mock-provider", Model: "mock-model"},
			{Name: "mock-blocked", AuthID: "mock-auth-blocked", Provider: "mock-provider", Model: "mock-model", Disabled: true},
		})
		if err != nil {
			log.Fatal(err)
		}
		runtime, closeMock = core, core
		defer closeMock.Close()
	} else {
		if *config == "" {
			log.Fatal("production mode requires --config")
		}
		managementToken := os.Getenv("OMS_CORE_MANAGEMENT_TOKEN")
		if len(managementToken) < 32 {
			log.Fatal("OMS_CORE_MANAGEMENT_TOKEN must contain at least 32 characters")
		}
		production, err = omscore.NewProductionCore(*config, managementToken)
		if err != nil {
			log.Fatal(err)
		}
		runtime = production
		go func() { serviceErrors <- production.Run(ctx) }()
	}
	handler, err := omscore.NewHandler(runtime, token)
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: *listen, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 0, IdleTimeout: 60 * time.Second}
	serverErrors := make(chan error, 1)
	go func() { serverErrors <- server.ListenAndServe() }()
	fmt.Printf("OMS core facade listening on http://%s (mock=%t)\n", *listen, *mock)
	serviceDone := false
	select {
	case <-ctx.Done():
	case err := <-serverErrors:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("OMS facade failed: %v", err)
		}
	case err := <-serviceErrors:
		serviceDone = true
		if err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("provider core failed: %v", err)
		}
	}
	cancel()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	_ = server.Shutdown(shutdownCtx)
	if production != nil {
		if !serviceDone {
			select {
			case <-serviceErrors:
			case <-shutdownCtx.Done():
			}
		}
		_ = production.Shutdown(shutdownCtx)
	}
}
